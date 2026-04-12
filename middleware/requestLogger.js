function requestLogger(req, _res, next) {
  const startedAt = Date.now();
  req.requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      level: 'info',
      type: 'request_start',
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      at: new Date().toISOString(),
    })
  );
  const done = () => {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        level: 'info',
        type: 'request_end',
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        durationMs: Date.now() - startedAt,
      })
    );
  };
  req.on('close', done);
  next();
}

module.exports = requestLogger;

