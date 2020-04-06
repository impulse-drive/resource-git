const cfg = require('./config');
const compressing = require('compressing');
const fs = require('fs');
const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node');

const nats = (() => {
    const nats = require('nats').connect(cfg.queue.url, { json: true });
    nats._publish = nats.publish;
    nats.publish = (topic, payload) => {
        console.log({[topic]: payload});
        nats._publish(topic, payload);
    };
    return nats;
})();

const minio = (() => {
    const Minio= require('minio');
    const client = new Minio.Client({
        endPoint: cfg.minio.host,
        port: cfg.minio.port,
        useSSL: false,
        accessKey: cfg.minio.accessKey,
        secretKey: cfg.minio.secretKey
    });
    client.bucketExists(cfg.minio.bucket, (error, exists) => {
        if(error) {
            console.error(error);
            process.exit(1);
        }
        if(!exists) {
            console.log(`creating bucket ${cfg.minio.bucket}`);
            client.makeBucket(cfg.minio.bucket, (error) => {
                console.error(error);
                process.exit(1);
            });
        }
    });
    return client;
})();

const url = commit => `${cfg.storage.url}/resource/${commit}.tar.gz`

const main = async commit => {
    const gitCfg = { fs, http, dir: cfg.srcdir, url: cfg.git.url};

    if(!commit) {
        console.log(`Performing initial clone of ${cfg.git.url}`);
        await git.clone({...gitCfg, ref: cfg.git.ref});
        commit = await git.resolveRef({...gitCfg, ref: cfg.git.ref});
        await store(commit).then(notify(commit));
        return setTimeout(main, cfg.git.pollTimeout, commit);
    }

    const updatedCommit = await git.fetch({...gitCfg, ref: cfg.git.ref}).then(x => x.fetchHead);

    if(commit === updatedCommit) {
        console.log(`commit ${commit} unchanged`);
        await store(commit).then(notify(commit));
        return setTimeout(main, cfg.git.pollTimeout, commit);
    }

    console.log(`${commit} != ${updatedCommit}`);
    if(commit != updatedCommit) {
        console.log(`commit ${commit} => ${updatedCommit}`);
        await git.checkout({...gitCfg, ref: updatedCommit});
        await store(commit).then(notify(commit));
        return setTimeout(main, cfg.git.pollTimeout, updatedCommit);
    }

}

const notify = identifier => msg => {
    nats.publish(cfg.name, { identifier, ...msg });
}

const store = commit => new Promise((resolve, reject) => {
    const bucket = cfg.minio.bucket;
    const object = `${commit}.tgz`;

    minio.statObject(cfg.minio.bucket, object, (error) => {
        if(error && error.code == 'NotFound') {
            const stream = (() => {
                const stream = new compressing.tgz.Stream();
                stream.addEntry(cfg.srcdir, { ignoreBase: true });
                return stream;
            })();

            return minio.putObject(cfg.minio.bucket, object, stream, (error, etag) => {
                if(error) {
                    return reject(error);
                }
                return resolve({ bucket, object });
            });
        }

        if(error) {
            return reject(error);
        }

        return resolve({ bucket, object });
    });

    return { bucket: cfg.minio.bucket, object };

});


main().catch(err => {
    console.log(err);
    process.exit(1);
});
