const poolMap = require('./pool-manager')
const sql = require('mssql')
const dbConfig = require('./conn-props')
const eachSeries = require('async/eachSeries')


class Database {
    constructor(name, schemas, tables) {
        this.name = name;
        this.schemas = schemas ?? new Set();
        this.tables = tables ?? [];
    }
}

class Table {
    constructor(schema, name, columns) {
        this.schema = schema
        this.name = name;
        this.columns = columns;
    }
}

class Column {
    constructor(name, type, isDefault, nullable) {
        this.name = name;
        this.type = type;
        this.isDefault = isDefault
        this.nullable = nullable
    }
}

// const srcDbProps = dbConfig.localhost.test
// const destDbProps = dbConfig.localhost.tms

const srcDbConfig = dbConfig.dev.tms
const destDbConfig  = dbConfig.sit.tms



// init connection pool
poolMap.get('src', srcDbConfig)
poolMap.get('dest', destDbConfig)


const ddl = `
    select t.TABLE_CATALOG as 'database',
       t.TABLE_SCHEMA  as 'schema',
       t.TABLE_NAME    as 'table',
       c.COLUMN_NAME   as 'column',
       c.COLUMN_DEFAULT as 'isDefault',
       c.IS_NULLABLE    as 'nullable',

       case
           when CHARACTER_MAXIMUM_LENGTH is null then c.DATA_TYPE
           else CONCAT(c.DATA_TYPE, '(', c.CHARACTER_MAXIMUM_LENGTH, ') ')
           end         as type
from INFORMATION_SCHEMA.TABLES t,
     INFORMATION_SCHEMA.COLUMNS c
where t.TABLE_NAME = c.TABLE_NAME;
    `
const srcDb = new Database(srcDbConfig.database);
const destDb = new Database(destDbConfig.database);

function transformDb(records, db) {
    let tabColMap = new Map();
    let tabSchemaMap = new Map();
    for (let {schema, table, column, type, isDefault, nullable} of records) {
        if (!tabColMap.has(table)) {
            tabColMap.set(table, []);
        }
        tabColMap.get(table).push(new Column(column, type, isDefault, nullable))
        tabSchemaMap.set(table, schema)
    }
    for (let [table, columns] of tabColMap.entries()) {
        db.tables.push(new Table(tabSchemaMap.get(table), table, columns))
        db.schemas.add(tabSchemaMap.get(table))
    }
    // console.dir(db)
}

async function buildDbObj(poolMap, name, query) {
    const pool = await poolMap.get(name);
    const request = pool.request()
    const res = await request.query(query)
    transformDb(res.recordset, 'src' === name ? srcDb : destDb)
    return request
}

async function execSql(poolMap, name, execList) {
    const pool = await poolMap.get(name);
    const transaction = pool.transaction()
    transaction.begin(async function (err) {
        if (err) {
            console.log('transaction begin error')
            return
        }
        const request = transaction.request()

        for (let ddl of execList) {

            await request.query(ddl, (err, res) => {
                if (err) {
                    console.log('transaction exec error', err)
                    transaction.rollback()
                    return
                }
                console.log('execute query:', res, ': success')
                request.query()
            })
        }


        // eachSeries(execList, function (ddl) {
        //     console.log('ddl:  ' + ddl)
        //     request.query(ddl, (err, res) => {
        //         if (err) {
        //             console.log('transaction execList error', err)
        //             return
        //         }
        //         // console.log('execList result ' + res)
        //     })
        //
        // }, function (err) {
        //     if (err) {
        //         console.log(' error', err)
        //
        //     }
        // })

        transaction.commit()
    })
    console.log('exec success: ' + execList)
}


const genDdl = {
    createSchemaDdl(schemaName) {
        return `create schema [${schemaName}];`
    },
    createTableDdl(schemaName, tableName, columns) {
        return `create table [${schemaName}].[${tableName}] ( ${columns.map(col=> `\n      [${col.name}]   ${col.type} ${'NO' ===col.nullable ? 'not null':''}`).join(',')} \n) \n`
    },

    dropTableDdl(schemaName, tableName) {
        return `drop table [${schemaName}].[${tableName}];\n`
    },

    addColumnDdl(schemaName, tableName, columns) {
        return `alter table [${schemaName}].[${tableName}] add ${columns.map(col=> `[${col.name}] ${col.type}`).join(', ')}; \n`
    },

    alterColumnDdl(schemaName, tableName, columns) {
        return `${columns.map(col => `alter table [${schemaName}].[${tableName}] alter column [${col.name}] ${col.type};`).join('\n')}`
    },

    dropColumnDdl(schemaName, tableName, columns) {
        return `alter table [${schemaName}].[${tableName}] drop column ${columns.map(col=> '['+col.name +']').join(', ')}; \n`
    }

}

const allDdlList = []

async function diffDb(src, dest) {
    const request = await buildDbObj(poolMap, 'src', ddl)
    await buildDbObj(poolMap, 'dest', ddl)

    let destTabMap = new Map()
    dest.tables.forEach(t => destTabMap.set(t.name, t))
    let addedTableList = []
    let updateTableList = []
    let deleteTableList = []

    for (let srcTable of src.tables) {
        // Get add tables
        if (!destTabMap.has(srcTable.name)) {
            deleteTableList.push(srcTable)
            continue
        }

        // Update tables
        let destTable = destTabMap.get(srcTable.name)

        let colMap = new Map()
        destTable.columns.forEach(col => colMap.set(col.name, col))
        let updateTab = {
            name: srcTable.name,
            schema: srcTable.schema,
            insertCol: [],
            alterCol: [],
            deleteCol: [],
        }
        for (let col of srcTable.columns) {
            // drop column.
            if (!colMap.has(col.name)) {
                updateTab.deleteCol.push(col)
                continue
            }
            // alter column.
            let destCol = colMap.get(col.name)
            if (col.name == destCol.name && col.type != destCol.type) {
                updateTab.alterCol.push(destCol)
                colMap.delete(col.name)
                continue
            }
            colMap.delete(col.name)
            // same column.
        }
        updateTab.insertCol.push(...colMap.values())
        if (updateTab.insertCol.length != 0 || updateTab.deleteCol.length != 0 || updateTab.alterCol.length != 0) {
            updateTableList.push(updateTab)
        }
        destTabMap.delete(srcTable.name)

    }
    addedTableList.push(...destTabMap.values())
    // console.log('added table:{}', addedTableList)
    // console.log('update table:{}', updateTableList)

    let {createSchemaDdl, createTableDdl, dropTableDdl, addColumnDdl, alterColumnDdl, dropColumnDdl} = genDdl


    const lackSchemaList = [...destDb.schemas].filter(schema => !src.schemas.has(schema))
    allDdlList.push(...lackSchemaList.map(schemaName => createSchemaDdl(schemaName)))
    allDdlList.push(...addedTableList.map(tab => createTableDdl(tab.schema, tab.name, tab.columns)))
    allDdlList.push(...deleteTableList.map(tab => dropTableDdl(tab.schema, tab.name)))
    allDdlList.push(...updateTableList.filter(tab => tab.insertCol.length > 0).map(tab => addColumnDdl(tab.schema, tab.name, tab.insertCol)))
    allDdlList.push(...updateTableList.filter(tab => tab.alterCol.length > 0).map(tab => alterColumnDdl(tab.schema, tab.name, tab.alterCol)))
    allDdlList.push(...updateTableList.filter(tab => tab.deleteCol.length > 0).map(tab => dropColumnDdl(tab.schema, tab.name, tab.deleteCol)))

    if (allDdlList.length === 0) {
        console.log('no ddl to generate.')
        return
    }

    const allddl = allDdlList.join('\n')
    console.log(allddl)

    // const pool = await poolMap.get('src')
    // const transaction = new sql.Transaction(pool)
    //
    // await transaction.begin(async (err) => {
    //     if (err) {
    //         console.log('transaction begin error', err)
    //         return
    //     }
    //
    //     await request.query(allddl, (err, res) => {
    //         if (err) {
    //             console.log('request query error', err)
    //             return
    //         }
    //         console.log(res, allddl)
    //
    //     })
    //     transaction.commit((err, res) => {
    //         if (err) {
    //             console.log('transaction commit error', err)
    //             transaction.rollback((err, res) => {
    //                 if (err) {
    //                     console.log('transaction rollback error', err)
    //
    //                 }
    //                 console.log('transaction rollback success', res)
    //             })
    //         }
    //         console.log(res)
    //     })
    // })
    console.log('success')
    // console.log('ddl 0: ' + allDdlList[0])
    // await execSql(poolMap, 'src', allDdlList)


}

diffDb(srcDb, destDb)

// execSql(poolMap, 'src', 'drop table test_exec;')


// const testTab = new Table('user', [new Column('id', 'int'),
//     new Column('user', 'varchar(255)'),
//     new Column('password', 'varchar(255)'),
//     new Column('email', 'varchar(255)')])
// console.log(genCreateTableDdl(testtab.schema,  tab.name, testTab.columns))
// console.log(genAddColumnDdl(testtab.schema,  tab.name, testTab.columns))
// console.log(genDropColumnDdl(testtab.schema,  tab.name, testTab.columns))