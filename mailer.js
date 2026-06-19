const nodemailer = require('nodemailer');

function createTransport() {
  return nodemailer.createTransport({
    host:   process.env.EMAIL_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.EMAIL_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

async function sendPasswordResetEmail(to, name, resetUrl) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log('[MAILER] Email not configured – reset URL:', resetUrl);
    return { success: true, simulated: true };
  }
  const transporter = createTransport();
  await transporter.sendMail({
    from: `"House of Angel Schools" <${process.env.EMAIL_USER}>`,
    to,
    subject: 'Password Reset Request – HOA Portal',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:28px 24px;border:1px solid #e5e7eb;border-radius:10px">
        <div style="text-align:center;margin-bottom:20px">
          <div style="display:inline-block;width:52px;height:52px;background:#1a2f8c;border-radius:50%;line-height:52px;text-align:center">
            <span style="color:#fff;font-size:22px">🔒</span>
          </div>
          <h2 style="color:#1a2f8c;margin:12px 0 4px">Password Reset</h2>
          <p style="color:#6b7280;font-size:0.85rem;margin:0">House of Angel Schools Portal</p>
        </div>
        <p style="color:#374151">Hello <strong>${name}</strong>,</p>
        <p style="color:#374151">You requested a password reset for your admin account. Click the button below to set a new password:</p>
        <div style="text-align:center;margin:24px 0">
          <a href="${resetUrl}"
             style="display:inline-block;padding:13px 32px;background:#1a2f8c;color:#fff;text-decoration:none;border-radius:7px;font-weight:600;font-size:0.95rem;letter-spacing:0.3px">
            Reset My Password
          </a>
        </div>
        <p style="color:#6b7280;font-size:0.83rem">Or copy this link into your browser:</p>
        <p style="font-size:0.78rem;word-break:break-all;color:#3555c8;background:#f0f4ff;padding:8px 12px;border-radius:5px">${resetUrl}</p>
        <p style="color:#9ca3af;font-size:0.8rem;margin-top:20px">This link expires in <strong>1 hour</strong>. If you did not request a password reset, you can safely ignore this email.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
        <p style="color:#9ca3af;font-size:0.75rem;text-align:center;margin:0">
          House of Angel Schools &mdash; <em>Excellence for Beginners</em>
        </p>
      </div>
    `,
  });
  return { success: true };
}

module.exports = { sendPasswordResetEmail };
