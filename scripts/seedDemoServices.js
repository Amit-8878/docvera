/* eslint-disable no-console */
const mongoose = require('mongoose');
const env = require('../config/env');
const Service = require('../models/Service');

async function main() {
  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 10000 });

  const demo = [
    {
      name: 'Document Printing',
      description: 'Print documents with flexible delivery options.',
      basePrice: 50,
      pricingType: 'per_page',
      priceRules: [
        { label: '1 Page', price: 10 },
        { label: '10 Pages', price: 80 },
        { label: '50 Pages', price: 350 },
      ],
      deliveryOptions: [
        { type: 'soft_copy', price: 0 },
        { type: 'hard_copy', price: 30 },
        { type: 'courier', price: 80 },
      ],
      documentTypes: ['PDF', 'DOCX', 'Image'],
      turnaroundTime: '1 day',
      requiredFields: [
        { label: 'Customer Name', type: 'text' },
        { label: 'Document File', type: 'file' },
      ],
    },
    {
      name: 'Aadhar Update / Print',
      description: 'Aadhar related print/update assistance.',
      basePrice: 100,
      pricingType: 'fixed',
      priceRules: [],
      deliveryOptions: [
        { type: 'soft_copy', price: 0 },
        { type: 'hard_copy', price: 40 },
      ],
      documentTypes: ['Aadhar Card'],
      turnaroundTime: '2 hours',
      requiredFields: [
        { label: 'Aadhar Number', type: 'text' },
        { label: 'Aadhar Card (photo)', type: 'file' },
      ],
    },
    {
      name: 'PAN Card Service',
      title: 'PAN Card Apply',
      description: 'PAN card apply/reprint assistance.',
      imageUrl: '',
      priceBasic: 99,
      priceStandard: 149,
      pricePremium: 199,
      featuresBasic: ['Online form assist', 'Soft copy delivery'],
      featuresStandard: ['Form + document check', 'Priority queue', 'Soft copy'],
      featuresPremium: ['Dedicated support', 'Express processing', 'Courier + soft copy'],
      deliveryTimeBasic: '5–7 days',
      deliveryTimeStandard: '3–5 days',
      deliveryTimePremium: '1–3 days',
      basePrice: 99,
      pricingType: 'fixed',
      priceRules: [],
      deliveryOptions: [
        { type: 'soft_copy', price: 0 },
        { type: 'courier', price: 100 },
      ],
      documentTypes: ['PAN Card'],
      turnaroundTime: '3-5 days',
      requiredFields: [
        { label: 'Full Name', type: 'text' },
        { label: 'ID Proof', type: 'file' },
      ],
    },
  ];

  for (const s of demo) {
    const existing = await Service.findOne({ name: s.name });
    if (existing) {
      await Service.updateOne({ _id: existing._id }, { $set: s });
      console.log('Updated demo service:', s.name);
    } else {
      await Service.create(s);
      console.log('Created demo service:', s.name);
    }
  }

  await mongoose.disconnect();
  console.log('Demo services seeded.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

