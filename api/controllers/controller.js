'use strict';

module.exports.sendCommand = (req, res) => {

    let id = req.swagger.params.id.value;
    let command = req.swagger.params.command.value;

    global.module.send(id, command)
        .then((status) => {
            res.json( { data: { status: status }, result : 'ok' } );
        })
        .catch((err) => {
            res.status(500).json({code: err.code || 0, message: err.message});
        });
};

module.exports.learnCommand = (req, res) => {

    let id = req.swagger.params.id.value;

    global.module.learn(id)
        .then((command) => {
            res.json( { data: { command: command }, result : 'ok' } );
        })
        .catch((err) => {
            res.status(500).json({code: err.code || 0, message: err.message});
        });
};