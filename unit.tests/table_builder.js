'use strict'
/* global suite teardown teardown test setup */

const supp = require('msnodesqlv8/samples/typescript/demo-support')
const assert = require('assert')

suite('table_builder', function () {
  let theConnection
  this.timeout(10000)
  let connStr
  let helper

  const sql = global.native_sql

  setup(testDone => {
    supp.GlobalConn.init(sql, co => {
      connStr = global.conn_str || co.conn_str
      helper = co.helper
      helper.setVerbose(false)
      sql.open(connStr, (err, newConn) => {
        assert(err === null || err === false)
        theConnection = newConn
        testDone()
      })
    }, global.conn_str)
  })

  teardown(done => {
    theConnection.close(err => {
      assert(err === null || err === false || err === undefined)
      done()
    })
  })

  class Checker {
    constructor (builder) {
      this.builder = builder
    }

    async check (makeOne, compare) {
      try {
        const builder = this.builder
        const table = builder.toTable()
        await builder.drop()
        await builder.create()
        const vec = []
        for (let i = 0; i < 20; ++i) {
          vec.push(makeOne(i))
        }
        await table.promises.insert(vec)
        const keys = vec.map(c => {
          return {
            id: c.id
          }
        })
        const s1 = await table.promises.select(keys)
        assert.deepStrictEqual(vec.length, s1.length)
        for (let i = 0; i < vec.length; ++i) {
          const lhs = vec[i]
          const rhs = s1[i]
          if (compare) {
            compare(lhs, rhs)
          } else {
            assert.deepStrictEqual(lhs, rhs)
          }
        }

        await builder.drop()
      } catch (e) {
        return e
      }
    }
  }

  test('use table builder to bind to a table int, decimal', testDone => {
    function makeOne (i) {
      return {
        id: i,
        col_a: i * 1.0 / (i * i * 1.0)
      }
    }

    function checkOne (lhs, rhs) {
      assert.deepStrictEqual(lhs.id, rhs.id)
      assert(Math.abs(lhs.col_a - rhs.col_a) < 1e-5)
    }

    async function test () {
      run(builder => {
        builder.addColumn('id').asInt().isPrimaryKey(1)
        builder.addColumn('col_a').asDecimal(23, 18)
      }, makeOne, checkOne)
    }

    test().then((e) => {
      testDone(e)
    }).catch(e => {
      testDone(e)
    })
  })

  async function run (adder, makeOne, checkOne) {
    try {
      const tableName = 'tmpTableBuilder'
      const mgr = theConnection.tableMgr()
      const builder = mgr.makeBuilder(tableName, 'scratch')

      adder(builder)

      const checker = new Checker(builder)
      await checker.check(makeOne, checkOne)
    } catch (e) {
      return e
    }
  }

  test('use table builder to bind to a table int, varchar', testDone => {
    function makeOne (i) {
      return {
        id: i,
        col_a: i * 5,
        col_b: `str_${i}`,
        col_c: i + 1,
        col_d: i - 1,
        col_e: `str2_${i}`
      }
    }

    async function test () {
      run(builder => {
        builder.addColumn('id').asInt().isPrimaryKey(1)
        builder.addColumn('col_a').asInt()
        builder.addColumn('col_b').asVarChar(100)
        builder.addColumn('col_c').asInt()
        builder.addColumn('col_d').asInt()
        builder.addColumn('col_e').asVarChar(100)
      }, makeOne)
    }

    test().then((e) => {
      testDone(e)
    }).catch(e => {
      testDone(e)
    })
  })
})
