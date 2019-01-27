'use strict';
require('array.prototype.find');

function _module(config) {

    if ( !(this instanceof _module) ){
        return new _module(config);
    }

    const redis = require('redis');
    var moment = require('moment');

    var iTach = require('node-itach');

    let pub = redis.createClient(
        {
            host: process.env.REDIS || global.config.redis || '127.0.0.1' ,
            socket_keepalive: true,
            retry_unfulfilled_commands: true
        }
    );

    pub.on('end', function(e){
        console.log('Redis hung up, committing suicide');
        process.exit(1);
    });

    var NodeCache = require( "node-cache" );

    var deviceCache = new NodeCache();
    var statusCache = new NodeCache();
    var controllers = {};

    var merge = require('deepmerge');

    var request = require('request');
    var https = require('https');
    var keepAliveAgent = new https.Agent({ keepAlive: true });
/*
    require('request').debug = true
    require('request-debug')(request);
*/

    deviceCache.on( 'set', function( key, value ){
        let data = JSON.stringify( { module: global.moduleName, id : key, value : value });
        console.log( 'sentinel.device.insert => ' + data );
        pub.publish( 'sentinel.device.insert', data);
    });

    deviceCache.on( 'delete', function( key ){
        let data = JSON.stringify( { module: global.moduleName, id : key });
        console.log( 'sentinel.device.delete => ' + data );
        pub.publish( 'sentinel.device.delete', data);
    });

    statusCache.on( 'set', function( key, value ){
        let data = JSON.stringify( { module: global.moduleName, id : key, value : value });
        //console.log( 'sentinel.device.update => ' + data );
        pub.publish( 'sentinel.device.update', data);
    });

	var that = this;

    function call(url) {

        return new Promise( (fulfill, reject) => {

            console.log(url);

            let options = {
                url : url,
                timeout : 90000,
                agent: keepAliveAgent
            };

            try {
                request(options, (err, response, body) => {
                    if (!err && response.statusCode == 200) {
                        fulfill(JSON.parse(body));
                    } else {
                        console.error(err||body);
                        reject(err||body);
                    }
                });
            }catch(e){
                console.error(err);
                reject(e);
            }
        } );
    }

    this.send = (id, command) => {

        return new Promise( (fulfill, reject) => {
            global.config.devices()
                .then( (results ) =>{

                    for( let controller of results ) {
                        if ( controller.id === id ){
                            for ( let device of controller.devices ) {
                                for ( let name of Object.keys( device.commands ) ) {
                                   if ( command === `${device.name}.${name}` ){

                                       let remote = controllers[id].remote;

                                       remote.send({ ir: device.commands[name] }, (err) => {
                                           if (err) {
                                               reject(err);
                                           } else {
                                               fulfill('sent');
                                           }
                                       });

                                       return;
                                   }
                                }
                            }
                        }
                    }

                    reject( { err: '404', message: 'not found' } );

                })
                .catch((err) => {
                    reject(err);
                });
        });
    }

    this.learn = (id) => {

        return new Promise( (fulfill, reject) => {
            global.config.devices()
                .then( (results ) =>{

                    for( let controller of results ) {

                        if ( controller.id === id ) {

                            let remote = controllers[id].remote;

                            remote.learn((err, code) => {
                                if (err) {
                                    reject(err);
                                } else {
                                    fulfill(code);
                                }
                            });

                            return;
                        }
                    }

                    reject( { err: '404', message: 'not found' } );
                })
                .catch((err) => {
                    reject(err);
                });
        });
    }

    this.getDevices = () => {

        return new Promise( (fulfill, reject) => {
            deviceCache.keys( ( err, ids ) => {
                if (err)
                    return reject(err);

                deviceCache.mget( ids, (err,values) =>{
                    if (err)
                        return reject(err);

                    statusCache.mget( ids, (err, statuses) => {
                        if (err)
                            return reject(err);

                        let data = [];

                        for (let key in values) {
                            let v = values[key];

                            if ( statuses[key] ) {
                                v.current = statuses[key];
                                data.push(v);
                            }
                        }

                        fulfill(data);
                    });

                });
            });
        });
    };

    this.getDeviceStatus = (id) => {

        return new Promise( (fulfill, reject) => {
            try {
                statusCache.get(id, (err, value) => {
                    if (err)
                        return reject(err);

                    fulfill(value);
                }, true);
            }catch(err){
                reject(err);
            }
        });

    };

    function updateStatus() {
        return new Promise( ( fulfill, reject ) => {
            global.config.devices()
                .then( (results ) =>{

                    results.forEach( (controller) => {

                        let activeCommands = [];
                        controller.devices.forEach( (device) => {
                            Object.keys( device.commands ).forEach( (name) =>{
                                activeCommands.push( `${device.name}.${name}` );
                            });
                        });

                        statusCache.set(controller.id, { commands : activeCommands } );

                    });

                    fulfill();
                })
                .catch((err) => {
                    console.error(err);
                    process.exit(1);
                });
        });
    }

    this.Reload = () => {
        return new Promise( (fulfill,reject) => {
            fulfill([]);
        });
    };

    function loadSystem(){
        return new Promise( ( fulfill, reject ) => {

            global.config.devices()
                .then( (results ) =>{

                    let devices = [];
                    results.forEach( (controller) => {

                        let d = {};

                        d['name'] = controller.name;
                        d['id'] = controller.id;
                        d['where'] = {'location': {}};
                        d['type'] = 'ir.transmitter';
                        d['current'] = {};

                        deviceCache.set(d.id, d);

                        controllers[d.id] = {
                            remote: new iTach({host: controller.address}),
                            devices: controller.devices
                        };

                        devices.push(d);
                    });

                    fulfill(devices);
                })
                .catch((err) => {
                    console.error(err);
                    process.exit(1);
                });
        });
    }

    loadSystem()

        .then( () => {

            function pollSystem() {
                updateStatus()
                    .then(() => {
                        setTimeout(pollSystem, 10000);
                    })
                    .catch((err) => {
                        console.error(err);
                        setTimeout(pollSystem, 60000);
                    });

            }

            setTimeout(pollSystem, 100);

        })
        .catch((err) => {
            console.error(err);
            process.exit(1);
        });

    return this;
}

module.exports = _module;