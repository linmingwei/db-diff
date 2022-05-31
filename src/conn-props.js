const localTest = {
    server: 'localhost', database: 'test', user: 'sa', password: 'my_pass123', isSrc: true,
}

const localTms = {
    server: 'localhost', database: 'tms', user: 'sa', password: 'my_pass123', isSrc: false,
}

const devTms = {
    server: 'sdb-sgrass-dev-az1-sql001.database.windows.net',
    database: 'tms_dev',
    user: 'tms_dev',
    password: 'Qwer!@1234',
    isSrc: true,
}

const sitTms = {
    server: 'sdb-sgrass-dev-az1-sql001.database.windows.net',
    database: 'tms',
    user: 'tms',
    password: 'Qwer!@1223',
    isSrc: false,
}

function buildConfig({server, database, user, password, isSrc}) {
    return {
        server: server, database: database, user: user, password: password, isSrc: isSrc, pool: {
            max: 10, min: 0, idleTimeoutMillis: 30000
        }, options: {
            encrypt: !server.includes('localhost'), // for azure
            trustServerCertificate: false // change to true for local dev / self-signed certs
        }
    }
}


module.exports = {
    "localhost": {
        "test": buildConfig(localTest), "tms": buildConfig(localTms)

    }, "dev": {
        "tms": buildConfig(devTms)

    }, "sit": {
        "tms": buildConfig(sitTms)
    }
}