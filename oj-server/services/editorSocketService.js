const redisClient = require('../modules/redisClient');
const TIMEOUT_IN_SECONDS = 3600;
module.exports = function(io) {
    // collaboraiton sessions
    const collaboraitons = {};
    // {
    //     1: {
    //         'participants': [123, 234, 345]
    //     }
    // }
    // map from socketId to sessionid
    const sessionPath = '/temp_sessions/';
    const socketIdToSessionId = {};

    io.on('connection', (socket) => {
        // console.log(socket);
        // const message = socket.handshake.query['message'];
        // console.log(message);

        // io.to(socket.id).emit('message', 'hhahaha from server');
        const sessionId = socket.handshake.query['sessionId'];

        socketIdToSessionId[socket.id] = sessionId;

        // if (!(sessionId in collaboraitons)) {
        //     collaboraitons[sessionId] = {
        //         'participants': []
        //     };
        // }
        // collaboraitons[sessionId]['participants'].push(socket.id);
        if (sessionId in collaboraitons) {
            collaboraitons[sessionId]['participants'].push(socket.id);
        } else {
            redisClient.get(sessionPath + '/' + sessionId, data => {
                if (data) {
                    console.log('session terminated perviously, pulling back from redis');
                    collaboraitons[sessionId] = {
                        'cachaedInstructions': JSON.parse(data),
                        'participants': []
                    };
                } else {
                    console.log('creating new session');
                    collaboraitons[sessionId] = {
                        'cachaedInstructions': [],
                        'participants': []
                    }
                }
                collaboraitons[sessionId]['participants'].push(socket.id);
            });
        }


        socket.on('change', delta => {
            const sessionId = socketIdToSessionId[socket.id];
            if (sessionId in collaboraitons) {
                collaboraitons[sessionId]['cachaedInstructions'].push(['change', delta, Date.now()]); 
            }
            if (sessionId in collaboraitons) {
                const participants = collaboraitons[sessionId]['participants'];
                for (let participant of participants) {
                    if (socket.id !== participant) {
                        io.to(participant).emit('change', delta);
                    }
                }
            } else {
                console.error('error');
            }
        });

        socket.on('restoreBuffer', () => {
            const sessionId = socketIdToSessionId[socket.id];
            if (sessionId in collaboraitons) {
                const instructions = collaboraitons[sessionId]['cachaedInstructions'];
                for (let instruction of instructions) {
                    socket.emit(instruction[0], instruction[1]);
                }
            }
        });

        socket.on('disconnect', () => {
            const sessionId = socketIdToSessionId[socket.id];
            let foundAndRemove = false;
            if (sessionId in collaboraitons) {
                const participants = collaboraitons[sessionId]['participants'];
                const index = participants.indexOf(socket.id);
                if (index >= 0) {
                    participants.splice(index, 1);
                    foundAndRemove = true;
                    if (participants.length === 0) {
                        const key = sessionPath + '/' + sessionId;
                        const value = JSON.stringify(collaboraitons[sessionId]['cachaedInstructions']);
                        redisClient.set(key, value, redisClient.redisPrint);
                        redisClient.expire(key, TIMEOUT_IN_SECONDS);
                        delete collaboraitons[sessionId];
                    }
                }
            }
            if (!foundAndRemove) {
                console.error('warning');
            }
        });
    });
}