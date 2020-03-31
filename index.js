// Configuration
const POLL_TIMEOUT = process.env.POLL_TIMEOUT || 3000;
const URL          = process.env.URL          || 'https://github.com/simonvpe/home-manager.git';
const REF          = process.env.REF          || 'master';
const PIPELINE     = process.env.PIPELINE     || 'pipeline';
const NAME         = process.env.NAME         || 'home-manager';
const STORAGE_URL  = process.env.STORAGE_URL  || 'http://localhost:3000';
const QUEUE_URL    = process.env.QUEUE_URL    || 'localhost:4444';

// Constants
const SRCDIR = '/tmp/source';

const path = require('path');
const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node');
const fs = require('fs');

const cfg = { fs, http, dir: SRCDIR, url: URL};

// Connections
const nc = require('nats').connect(QUEUE_URL, { json: true });

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
        console.log({commit, updatedCommit});
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

    const url = `${STORAGE_URL}/resources/${NAME}/${commit}.tar.gz`;

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
    console.log({identifier, url});
    const subject = `${PIPELINE}/resource/${NAME}`;
    nc.publish(subject, { identifier, url });
}

main().catch(err => {
    console.log(err);
    process.exit(1);
});
