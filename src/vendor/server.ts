import express from 'express';

const app = express();

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', service: 'vendor-target' });
});

app.get('/', (_req, res) => {
  res
    .type('html')
    .send(
      '<h1>Living Vendor Graph demo</h1><p>Placeholder for the vendor target app (public pricing + authenticated dashboard).</p>',
    );
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`vendor-target listening on :${port}`);
});
