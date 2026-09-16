// Local development server entry point (Vercel uses api/index.js -> app.js instead)
require('dotenv').config();
const app = require('./app');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = process.env.PORT || 3000;

if (require.main === module) {
  const server = app.listen(PORT, HOST, () => {
    const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
    console.log(`TRIPLE DIMENSION running at http://${displayHost}:${PORT}`);
  });

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Stop the other server process or set a different PORT in .env.`);
      process.exit(1);
    }
    console.error('Server failed to start:', err);
    process.exit(1);
  });
}

module.exports = app;
