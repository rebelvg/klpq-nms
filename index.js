const NodeMediaServer = require('node-media-server');
const _ = require('lodash');
require('longjohn');

const config = require('./config.json').nms;
const channelsConfig = require('./config.json').channels;

const nms = new NodeMediaServer(config);
nms.run();

nms.on('preConnect', (id, args) => {
    console.log('[NodeEvent on preConnect]', `id=${id} args=${JSON.stringify(args)}`);

    let session = nms.getSession(id);

    //timeout hack
    switch (session.constructor.name) {
        case 'NodeRtmpSession': {
            console.log('rtmp preConnect', id, session.socket.remoteAddress);

            session.socket.setTimeout(20000);

            session.socket.on('timeout', () => {
                try {
                    console.log(`${id} socket timeout.`, _.get(session, ['socket', 'remoteAddress'], null));

                    let socket = session.socket;
                    session.stop();
                    socket.destroy();
                } catch (e) {
                    console.log(e);
                }
            });

            break;
        }
        case 'NodeFlvSession': {
            console.log(session.TAG === 'websocket-flv' ? 'ws preConnect' : 'http preConnect', _.get(session, ['req', 'connection', 'remoteAddress'], null));

            break;
        }
    }

    session.connectTime = new Date();
});

nms.on('postConnect', (id, args) => {
    console.log('[NodeEvent on postConnect]', `id=${id} args=${JSON.stringify(args)}`);
});

nms.on('doneConnect', (id, args) => {
    console.log('[NodeEvent on doneConnect]', `id=${id} args=${JSON.stringify(args)}`);
});

nms.on('prePublish', (id, StreamPath, args) => {
    console.log('[NodeEvent on prePublish]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);

    let session = nms.getSession(id);

    let regRes = /\/(.*)\/(.*)/gi.exec(StreamPath);

    if (regRes === null) return session.reject();

    if (!_.has(channelsConfig, [regRes[1], regRes[2]])) return session.reject();

    let password = _.get(channelsConfig, [regRes[1], regRes[2], 'publish'], null);

    if (password !== args.password) return session.reject();
});

nms.on('postPublish', (id, StreamPath, args) => {
    console.log('[NodeEvent on postPublish]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
});

nms.on('donePublish', (id, StreamPath, args) => {
    console.log('[NodeEvent on donePublish]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
});

nms.on('prePlay', (id, StreamPath, args) => {
    console.log('[NodeEvent on prePlay]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);

    let session = nms.getSession(id);

    let regRes = /\/(.*)\/(.*)/gi.exec(StreamPath);

    if (regRes === null) return session.reject();

    if (!_.has(channelsConfig, [regRes[1], regRes[2]])) return session.reject();
});

nms.on('postPlay', (id, StreamPath, args) => {
    console.log('[NodeEvent on postPlay]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
});

nms.on('donePlay', (id, StreamPath, args) => {
    console.log('[NodeEvent on donePlay]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
});

let router = nms.nhs.expressApp;

router.get('/channels', function (req, res, next) {
    let stats = {};

    let sessions = {};

    nms.sessions.forEach(function (session, id) {
        if (session.isStarting) {
            sessions[id] = session;

            let regRes = /\/(.*)\/(.*)/gi.exec(session.publishStreamPath || session.playStreamPath);

            if (regRes === null) return;

            let [app, channel] = _.slice(regRes, 1);

            _.set(stats, [app, channel], {
                publisher: null,
                subscribers: []
            });
        }
    });

    let publishers = _.filter(sessions, {'isPublishing': true});
    let subscribers = _.filter(sessions, (session) => {
        return !!session.playStreamPath;
    });

    _.forEach(publishers, (session, id) => {
        let regRes = /\/(.*)\/(.*)/gi.exec(session.publishStreamPath);

        if (regRes === null) return;

        let [app, channel] = _.slice(regRes, 1);

        _.set(stats, [app, channel, 'publisher'], {
            app: app,
            channel: channel,
            serverId: session.id,
            connectCreated: session.connectTime,
            bytes: session.socket.bytesRead,
            ip: session.socket.remoteAddress
        });
    });

    _.forEach(subscribers, (session) => {
        let regRes = /\/(.*)\/(.*)/gi.exec(session.playStreamPath);

        if (regRes === null) return;

        let [app, channel] = _.slice(regRes, 1);

        switch (session.constructor.name) {
            case 'NodeRtmpSession': {
                stats[app][channel]['subscribers'].push({
                    app: app,
                    channel: channel,
                    serverId: session.id,
                    connectCreated: session.connectTime,
                    bytes: session.socket.bytesWritten,
                    ip: session.socket.remoteAddress,
                    protocol: 'rtmp'
                });

                break;
            }
            case 'NodeFlvSession': {
                stats[app][channel]['subscribers'].push({
                    app: app,
                    channel: channel,
                    serverId: session.id,
                    connectCreated: session.connectTime,
                    bytes: session.req.connection.bytesWritten,
                    ip: session.req.connection.remoteAddress,
                    protocol: session.TAG === 'websocket-flv' ? 'ws' : 'http'
                });

                break;
            }
        }
    });

    res.json(stats);
});

router.get('/channels/:app/:channel', function (req, res, next) {
    let channelStats = {
        isLive: false,
        viewers: 0,
        duration: 0,
        bitrate: 0
    };

    let playStreamPath = `/${req.params.app}/${req.params.channel}`;

    let publisherSession = nms.sessions.get(nms.publishers.get(playStreamPath));

    channelStats.isLive = !!publisherSession;
    channelStats.viewers = _.filter(Array.from(nms.sessions.values()), (session) => {
        return session.playStreamPath === playStreamPath;
    }).length;
    channelStats.duration = channelStats.isLive ? Math.ceil((Date.now() - publisherSession.startTimestamp) / 1000) : 0;
    channelStats.bitrate = channelStats.duration > 0 ? Math.ceil(_.get(publisherSession, ['socket', 'bytesRead'], 0) * 8 / channelStats.duration / 1024) : 0;

    res.json(channelStats);
});

process.on('uncaughtException', (err) => {
    console.log('server crashed.');
    console.log('uncaughtException', err);

    throw err;
});

console.log('server running.');
