import mongoose from 'mongoose';
mongoose.connect('mongodb://127.0.0.1:27017/poultry_record_app').then(async () => {
  const Trip = mongoose.model('Trip', new mongoose.Schema({ date: Date, purchases: Array, sales: Array }, { strict: false }));
  const trips = await Trip.find({}, 'date');
  console.log('Total trips in DB:', trips.length);
  const byMonth = {};
  trips.forEach(t => {
    const d = new Date(t.date);
    if(isNaN(d.getTime())) return;
    const m = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    byMonth[m] = (byMonth[m] || 0) + 1;
  });
  console.log('Trips by month:', byMonth);
  process.exit(0);
}).catch(console.error);
