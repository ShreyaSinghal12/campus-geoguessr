// Database connection pool. One pool is shared by the whole app.
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  database: process.env.PGDATABASE
});

// query() is a thin wrapper so routes never touch the pool directly.
function query(text, params) {
  return pool.query(text, params);
}

module.exports = { query };