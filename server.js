// server.js
// Entry point for elder-android-backend — a standalone Express service for
// the Android app, sharing only the Airtable base with coastal-elder-scheduler.

const express = require('express');
const cors = require('cors');
const config = require('./config');
const elderSchedulingRouter = require('./routes/elderScheduling');

const app = express();

app.use(cors()); // dev-open; tighten to specific origins before production use
app.use(express.json());

app.use('/api', elderSchedulingRouter);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Basic error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(config.port, () => {
  console.log(`elder-android-backend listening on port ${config.port}`);
});
