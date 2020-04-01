// Configuration
const NAME         = process.env.NAME;
const POLL_TIMEOUT = process.env.POLL_TIMEOUT;
const URL          = process.env.URL;
const REF          = process.env.REF;
const STORAGE_URL  = process.env.STORAGE_URL;
const QUEUE_URL    = process.env.QUEUE_URL;

if(!/^pipeline\.[0-9a-zA-Z\-\_]+\.resource\.[0-9a-zA-Z\-\_]+$/.test(NAME)) {
    console.error(`NAME=${NAME}: bad name`);
    process.exit(1);
}

if(!/^\+?(0|[1-9]\d*)$/.test(POLL_TIMEOUT)) {
    console.error(`POLL_TIMEOUT=${POLL_TIMEOUT}: not a normal number`);
    process.exit(1);
}

if(!URL) {
    console.error(`URL=${URL}`);
    process.exit(1);
}

if(!REF) {
    console.error(`REF=${REF}`);
    process.exit(1);
}

if(!STORAGE_URL) {
    console.error(`STORAGE_URL=${STORAGE_URL}`);
    process.exit(1);
}

if(!QUEUE_URL) {
    console.error(`QUEUE_URL=${QUEUE_URL}`);
    process.exit(1);
}

// Constants
const SRCDIR = '/tmp/source';

const path = require('path');
const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node');
const fs = require('fs');

const cfg = { fs, http, dir: SRCDIR, url: URL};

// Connections
const nats = require('nats').connect(QUEUE_URL, { json: true });

nats._publish = nats.publish;
nats.publish = (topic, payload) => {
    console.log({[topic]: payload});
    nats._publish(topic, payload);
};

// Application
const main = async commit => {

    if(!commit) {
        console.log(`Performing initial clone of ${URL}`);
        await git.clone({...cfg, ref: REF});
        commit = await git.resolveRef({...cfg, ref: REF});
        store(commit).then(notify(commit));
        return setTimeout(main, POLL_TIMEOUT, commit);
    }

    const updatedCommit = await git.fetch({...cfg, ref: REF}).then(x => x.fetchHead);
    if(commit != updatedCommit) {
        await git.checkout({...cfg, ref: updatedCommit});
        store(commit).then(notify(commit));
        return setTimeout(main, POLL_TIMEOUT, updatedCommit);
    }

    return setTimeout(main, POLL_TIMEOUT, commit);
}

const store = commit => new Promise((resolve, reject) => {
    const request = require('request');
    const fs = require('fs');
    const compressing = require('compressing');

    const url = `${STORAGE_URL}/resource/${commit}.tar.gz`;

    const rs = (() => {
        const stream = new compressing.tgz.Stream();
        stream.addEntry(SRCDIR, { ignoreBase: true });
        return stream;
    })();

    const ws = request.post(url);

    ws.on('drain', () => {
        rs.resume();
    });

    ws.on('error', err => {
        reject(err);
    });

    ws.on('response', res => {
        if(res.statusCode != 200) {
            reject(res.statusCode);
        }
        resolve(url);
    })

    rs.pipe(ws);
});

const notify = identifier => url => {
    nats.publish(NAME, { identifier, url });
}

main().catch(err => {
    console.log(err);
    process.exit(1);
});
