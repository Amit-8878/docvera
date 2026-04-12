const NotificationTemplate = require('../models/NotificationTemplate');

const DEFAULT_TEMPLATES = {
  order_placed: {
    en: '{{name}} ji, your order #{{orderId}} has been placed successfully.',
    hi: '{{name}} जी, आपका ऑर्डर #{{orderId}} सफलतापूर्वक हो गया है।',
    hinglish: '{{name}} ji, aapka order #{{orderId}} successfully place ho gaya hai.',
  },
  agent_assigned: {
    en: '{{name}} ji, agent has been assigned to order #{{orderId}}.',
    hi: '{{name}} जी, ऑर्डर #{{orderId}} पर एजेंट असाइन कर दिया गया है।',
    hinglish: '{{name}} ji, order #{{orderId}} par agent assign ho gaya hai.',
  },
  status_processing: {
    en: '{{name}} ji, your order #{{orderId}} is now processing.',
    hi: '{{name}} जी, आपका ऑर्डर #{{orderId}} अब प्रोसेसिंग में है।',
    hinglish: '{{name}} ji, aapka order #{{orderId}} ab processing me hai.',
  },
  status_completed: {
    en: '{{name}} ji, your order #{{orderId}} is completed and proof uploaded.',
    hi: '{{name}} जी, आपका ऑर्डर #{{orderId}} पूरा हो गया है और प्रूफ अपलोड हो गया है।',
    hinglish: '{{name}} ji, aapka order #{{orderId}} complete ho gaya hai aur proof upload ho gaya hai.',
  },
  payment_released: {
    en: '{{name}} ji, payment for order #{{orderId}} has been released.',
    hi: '{{name}} जी, ऑर्डर #{{orderId}} का भुगतान जारी कर दिया गया है।',
    hinglish: '{{name}} ji, order #{{orderId}} ka payment release ho gaya hai.',
  },
  issue_raised: {
    en: '{{name}} ji, issue raised for order #{{orderId}}. Admin will review soon.',
    hi: '{{name}} जी, ऑर्डर #{{orderId}} के लिए समस्या दर्ज हो गई है। एडमिन जल्द देखेगा।',
    hinglish: '{{name}} ji, order #{{orderId}} ke liye issue raise ho gaya hai. Admin jaldi review karega.',
  },
  admin_new_order: {
    en: 'New order #{{orderId}} placed by {{name}}.',
    hi: '{{name}} द्वारा नया ऑर्डर #{{orderId}} किया गया है।',
    hinglish: '{{name}} ne naya order #{{orderId}} place kiya hai.',
  },
};

function render(template, data = {}) {
  return String(template || '').replace(/\{\{(\w+)\}\}/g, (_m, key) => {
    if (data[key] == null) return '';
    return String(data[key]);
  });
}

async function ensureDefaultTemplates() {
  const events = Object.keys(DEFAULT_TEMPLATES);
  for (const event of events) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await NotificationTemplate.findOne({ event }).lean();
    if (!exists) {
      // eslint-disable-next-line no-await-in-loop
      await NotificationTemplate.create({ event, messages: DEFAULT_TEMPLATES[event] });
    }
  }
}

async function getTemplate(event) {
  const db = await NotificationTemplate.findOne({ event }).lean();
  if (db) return db;
  const fallback = DEFAULT_TEMPLATES[event];
  if (!fallback) return null;
  return { event, messages: fallback };
}

async function buildMessage(event, data = {}, language = 'en') {
  const template = await getTemplate(event);
  if (!template) return '';
  const lang = language === 'hi' || language === 'hinglish' ? language : 'en';
  const selected = template.messages?.[lang] || template.messages?.en || '';
  return render(selected, data);
}

async function listTemplates() {
  await ensureDefaultTemplates();
  return NotificationTemplate.find({}).sort({ event: 1 }).lean();
}

async function upsertTemplate(event, messages) {
  return NotificationTemplate.findOneAndUpdate(
    { event },
    {
      $set: {
        messages: {
          en: messages?.en || '',
          hi: messages?.hi || '',
          hinglish: messages?.hinglish || '',
        },
      },
    },
    { new: true, upsert: true, runValidators: false }
  ).lean();
}

module.exports = {
  DEFAULT_TEMPLATES,
  ensureDefaultTemplates,
  buildMessage,
  listTemplates,
  upsertTemplate,
};

