const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const Order = require('../models/Order');
const User = require('../models/User');
const { enqueueOrderJob } = require('../modules/jobs/jobQueue');

async function ensureRealOrder() {
  let order = await Order.findOne().sort({ createdAt: -1 });
  if (order) return order;

  const user = await User.findOne().select('_id').lean();
  if (!user) {
    return null;
  }

  order = await Order.create({
    user: user._id,
    requestType: 'custom',
    customServiceName: 'job-queue-test',
    amount: 1,
    totalPrice: 1,
    finalCalculatedPrice: 1,
    paymentStatus: 'paid',
    paid: true,
    status: 'paid',
  });
  // eslint-disable-next-line no-console
  console.log('[testOrderJob] Created minimal order for enqueue test');
  return order;
}

async function test() {
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/docvera';
  let exitCode = 0;
  try {
    await mongoose.connect(uri);

    const order = await ensureRealOrder();
    if (!order) {
      console.log('No order found in DB and could not create one (need at least one user)');
      exitCode = 1;
      return;
    }

    const orderId = String(order._id);
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      console.error('[testOrderJob] Refusing to enqueue: not a valid MongoDB ObjectId', { orderId });
      exitCode = 1;
      return;
    }

    console.log('Sending test job...', { orderId });

    await enqueueOrderJob('order_generate_invoice', {
      orderId,
    });

    console.log('Job sent successfully');
  } catch (err) {
    console.error('Error:', err);
    exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
  process.exit(exitCode);
}

test();
