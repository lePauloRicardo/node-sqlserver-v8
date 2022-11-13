'use strict'

/* globals describe it */

const chai = require('chai')
const expect = chai.expect
chai.use(require('chai-as-promised'))
const { TestEnv } = require('./env/test-env')
const env = new TestEnv()

describe('encrypt', function () {
  this.timeout(30000)

  this.beforeEach(done => {
    env.open().then(() => done())
  })

  this.afterEach(done => {
    env.close().then((e) => {
      done()
    })
  })

  const withEncrypt = 'COLLATE Latin1_General_BIN2 ENCRYPTED WITH (' +
    'COLUMN_ENCRYPTION_KEY = [CEK_Auto1], ' +
    'ENCRYPTION_TYPE = Deterministic, ' +
    'ALGORITHM = \'AEAD_AES_256_CBC_HMAC_SHA_256\'' +
    ')'

  async function prepare (builder, procDef2) {
    await builder.drop()
    await builder.create()

    const promises = env.theConnection.promises
    const procTest = env.procTest(procDef2)
    await procTest.drop()
    await procTest.create()
    await promises.query(`exec sp_refresh_parameter_encryption ${procDef2.name}`)
  }

  function makeProcSql (tableName, procname, builder) {
    const { EOL } = require('os')
    const cnl = `, ${EOL}\t\t`
    const nl = `${EOL}\t\t`
    const insertColumns = builder.columns.filter(c => !c.is_identity)
    const params = insertColumns.map(c => `@${c.name} ${c.procTyped()}`).join(cnl)
    const declare = insertColumns.map(c => `declare @ae_${c.name} ${c.procTyped()} = @${c.name}`).join(nl)
    const paramNames = insertColumns.map(c => `${c.name}`).join(', ')
    const declareNames = insertColumns.map(c => `@ae_${c.name}`).join(', ')
    const insert = `insert into ${tableName} (${paramNames})`
    const values = `values (${declareNames})`
    const sql2 = `create procedure ${procname}
    ( 
      ${params}
    )
    as
    begin
      ${declare}
      ${insert}
      output inserted.*
      ${values}
    end
    `
    return sql2
  }

  // need to use table builder with decorator withEncrypt - generate a wrapper proc
  // based on columns.
  it('encrypted char via proc',
    async function handler () {
      if (!env.connectionString.includes('ColumnEncryption=Enabled')) return
      const procname = 'insert_emp_enc'
      const tableName = 'Employees'

      const mgr = env.theConnection.tableMgr()
      const dbName = await env.getDbName()
      const builder = mgr.makeBuilder(tableName, dbName)
      builder.addColumn('EmployeeID').asInt().isIdentity(1, 1)
      builder.addColumn('SSN').asChar(11).withDecorator(`${withEncrypt} NULL`)
      builder.addColumn('FirstName').asNVarChar(50).notNull()
      builder.addColumn('LastName').asNVarChar(50).null()
      builder.addColumn('Salary').asMoney()
      builder.toTable()
      const procSql = makeProcSql(tableName, procname, builder)
      const procDef2 = {
        name: procname,
        sql: procSql
      }
      await prepare(builder, procDef2)
      const procParams = {
        SSN: '12345678901',
        FirstName: 'boring',
        LastName: 'bob',
        Salary: 3456.012
      }
      const expected = {
        EmployeeID: 1,
        FirstName: procParams.FirstName,
        LastName: procParams.LastName,
        SSN: procParams.SSN,
        Salary: procParams.Salary
      }
      const promises = env.theConnection.promises
      const res = await promises.callProc(procname, procParams)
      expect(res.first[0]).to.deep.equals(expected)
      const res2 = await promises.query(`select * from ${tableName} `)
      expect(res2.first[0]).to.deep.equals(expected)
    })

  it('encrypted nvarchar via proc',
    async function handler () {
      if (!env.connectionString.includes('ColumnEncryption=Enabled')) return
      const procname = 'insert_emp_enc'
      const tableName = '[dbo].[Employees]'
      const procDef = {
        name: procname,
        sql: `create PROCEDURE ${procname}
  @ssn char(11),
  @firstname nvarchar(50),
  @lastname nvarchar(50),
  @salary money
as
begin
    declare @ae_ssn char(11)  = @ssn
    declare @ae_firstname nvarchar(50) = @firstname
    declare @ae_lastname nvarchar(50) = @lastname
    declare @ae_salary money =  @salary

    insert into ${tableName} (ssn, firstname, lastname, salary)
    output inserted.*
    values (@ae_ssn, @ae_firstname, @ae_lastname, @ae_salary)
end
`
      }

      const tableDef = `CREATE TABLE ${tableName}(
      [EmployeeID] [int] IDENTITY(1,1) NOT NULL,
      [SSN] [char](11) NULL,
      [FirstName] [nvarchar](50) ${withEncrypt} NOT NULL,
      [LastName] [nvarchar](50) NOT NULL,
      [Salary] [money] NULL
    ) ON [PRIMARY]
    `

      const promises = env.theConnection.promises
      const procTest = env.procTest(procDef)
      const dropTableSql = env.dropTableSql(tableName)
      await promises.query(dropTableSql)
      await procTest.drop()
      await promises.query(tableDef)
      await procTest.create()
      await promises.query(`exec sp_refresh_parameter_encryption ${procname}`)
      const procParams = {
        ssn: '12345678901',
        firstname: 'boring',
        lastname: 'bob',
        salary: 3456.012
      }
      const expected = {
        EmployeeID: 1,
        FirstName: procParams.firstname,
        LastName: procParams.lastname,
        SSN: procParams.ssn,
        Salary: procParams.salary
      }
      const res = await promises.callProc(procname, procParams)
      expect(res.first[0]).to.deep.equals(expected)
      await promises.query(`insert into ${tableName} values (?, ?, ? , ?)`, [
        procParams.ssn,
        procParams.firstname,
        procParams.lastname,
        procParams.salary
      ])
      const res2 = await promises.query(`select * from ${tableName} `)
      expect(res2.first[0]).to.deep.equals(expected)
    })
})
