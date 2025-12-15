const express = require('express');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 3000;
const FRONTEND_ID = process.env.FRONTEND_ID || '1';

app.use(express.static(path.join(__dirname, 'public')));

app.get('/info', (req, res) => {
    res.json({ frontend_id: FRONTEND_ID });
});

app.listen(PORT, () => {
    console.log(`Frontend ${FRONTEND_ID} running on port ${PORT}`);
});
