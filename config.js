module.exports = {
    name: process.env.NAME,
    srcdir: '/tmp/src',
    git: {
        pollTimeout: process.env.POLL_TIMEOUT,
        url: process.env.URL,
        ref: process.env.REF
    },
    storage: {
        url: process.env.STORAGE_URL
    },
    queue: {
        url: process.env.QUEUE_URL
    },
    minio: {
        host: process.env.MINIO_HOST,
        port: process.env.MINIO_PORT && Number(process.env.MINIO_PORT),
        accessKey: process.env.MINIO_ACCESS_KEY,
        secretKey: process.env.MINIO_SECRET_KEY,
        bucket: process.env.MINIO_BUCKET
    }
}

