const nodemailer = require('nodemailer');
const Tenant = require('../models/Tenant');

// Helper to create Nodemailer Transporter
const createTransporter = () => {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  // Fallback to ethereal / test transporter if SMTP env not provided
  return {
    sendMail: async (options) => {
      console.log('--- 📧 MOCK EMAIL BROADCAST (SMTP credentials missing in .env) ---');
      console.log(`To: ${options.to}`);
      console.log(`Subject: ${options.subject}`);
      console.log(`Body Snippet: ${options.text || options.html?.substring(0, 100)}...`);
      console.log('-----------------------------------------------------------------');
      return { messageId: 'mock-mail-id-' + Date.now() };
    }
  };
};

// Send email to a specific client organization
exports.sendSingleEmail = async (req, res) => {
  try {
    const { targetEmail, subject, body, templateType } = req.body;

    if (!targetEmail || !subject || !body) {
      return res.status(400).json({ error: 'Target email, subject, and body content are required' });
    }

    const transporter = createTransporter();

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; background-color: #090d16; color: #f8fafc; padding: 30px; borderRadius: 16px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="color: #f59e0b; margin: 0; font-size: 24px;">🐺 Wolf AI Master Notification</h1>
          <p style="color: #94a3b8; font-size: 13px;">Official Communication from Wolf AI Super Owner Team</p>
        </div>
        <div style="background-color: #0f172a; border: 1px solid #1e293b; padding: 20px; border-radius: 12px; font-size: 14px; line-height: 1.6; color: #e2e8f0;">
          ${body.replace(/\n/g, '<br/>')}
        </div>
        <div style="margin-top: 30px; text-align: center; font-size: 11px; color: #64748b; border-top: 1px solid #1e293b; padding-top: 15px;">
          Wolf AI WhatsApp Automation Platform • Super Owner Command Center<br/>
          Need urgent help? Reply directly to this email.
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: `"Wolf AI Owner" <${process.env.SMTP_FROM || 'admin@wolfai.com'}>`,
      to: targetEmail,
      subject: subject,
      text: body,
      html: htmlContent
    });

    res.status(200).json({
      success: true,
      message: `✉️ Email successfully sent to ${targetEmail}!`
    });
  } catch (error) {
    console.error('Error sending single email:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
};

// Send Broadcast Email to ALL Registered Client Organizations
exports.sendBroadcastEmail = async (req, res) => {
  try {
    const { subject, body } = req.body;

    if (!subject || !body) {
      return res.status(400).json({ error: 'Subject and email body are required for broadcast' });
    }

    const tenants = await Tenant.find({}, 'email name');
    const recipientEmails = tenants.map(t => t.email).filter(Boolean);

    if (recipientEmails.length === 0) {
      return res.status(400).json({ error: 'No registered client emails found' });
    }

    const transporter = createTransporter();

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; background-color: #090d16; color: #f8fafc; padding: 30px; borderRadius: 16px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="color: #f59e0b; margin: 0; font-size: 24px;">🐺 Wolf AI Platform Broadcast Announcement</h1>
          <p style="color: #94a3b8; font-size: 13px;">Sent to all Wolf AI Business Partners & Clients</p>
        </div>
        <div style="background-color: #0f172a; border: 1px solid #1e293b; padding: 20px; border-radius: 12px; font-size: 14px; line-height: 1.6; color: #e2e8f0;">
          ${body.replace(/\n/g, '<br/>')}
        </div>
        <div style="margin-top: 30px; text-align: center; font-size: 11px; color: #64748b; border-top: 1px solid #1e293b; padding-top: 15px;">
          Wolf AI Platform Update • Super Owner Control Room<br/>
          You are receiving this as a registered business owner on Wolf AI.
        </div>
      </div>
    `;

    // Send broadcast
    for (const email of recipientEmails) {
      try {
        await transporter.sendMail({
          from: `"Wolf AI Executive Team" <${process.env.SMTP_FROM || 'admin@wolfai.com'}>`,
          to: email,
          subject: `[Wolf AI Broadcast] ${subject}`,
          text: body,
          html: htmlContent
        });
      } catch (err) {
        console.error(`Failed to send broadcast email to ${email}:`, err);
      }
    }

    res.status(200).json({
      success: true,
      recipientsCount: recipientEmails.length,
      message: `🚀 Broadcast email successfully sent to ${recipientEmails.length} registered business emails!`
    });
  } catch (error) {
    console.error('Error sending broadcast email:', error);
    res.status(500).json({ error: 'Failed to send broadcast email' });
  }
};
