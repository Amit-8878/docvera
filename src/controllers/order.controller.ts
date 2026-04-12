import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Order = require('../../models/Order.js');

// Admin special: Order complete karke document attach karna
export const completeOrderWithDocument = async (req: any, res: any) => {
  try {
    const { orderId } = req.params;
    const documentUrl = req.file ? `/uploads/documents/${req.file.filename}` : req.body.documentUrl;

    if (!documentUrl) {
      return res.status(400).json({ success: false, message: 'Document is required to complete order' });
    }

    const order = await Order.findByIdAndUpdate(
      orderId,
      {
        status: 'completed',
        documentUrl: documentUrl,
        completedAt: new Date(),
      },
      { new: true }
    );

    res.status(200).json({ success: true, data: order });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
