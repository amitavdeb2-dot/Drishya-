import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route for sending invites
  app.post("/api/send-invite", async (req, res) => {
    const { toEmail, projectName, inviteLink, roleName } = req.body;
    const apiKey = process.env.BREVO_API_KEY;

    if (!apiKey) {
      console.warn("BREVO_API_KEY is missing, skipping email send");
      return res.status(500).json({ error: "Email service not configured. Please set BREVO_API_KEY." });
    }

    try {
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "accept": "application/json",
          "api-key": apiKey,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          sender: {
            name: process.env.BREVO_SENDER_NAME || "Drishya",
            email: process.env.BREVO_SENDER_EMAIL || "no-reply@drishya.app"
          },
          to: [{ email: toEmail }],
          subject: `Join the production team for "${projectName}"`,
          htmlContent: `
            <html>
              <body style="font-family: sans-serif; line-height: 1.6; color: #333; background-color: #f9fafb; padding: 40px 20px;">
                <div style="max-width: 600px; margin: 0 auto; padding: 40px; border: 1px solid #e5e7eb; border-radius: 16px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
                  <div style="text-align: center; margin-bottom: 32px;">
                    <div style="width: 48px; height: 48px; background-color: #2563eb; color: white; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; font-size: 24px; font-weight: bold; line-height: 48px;">
                      D
                    </div>
                  </div>
                  <h1 style="color: #111827; font-size: 24px; font-weight: 800; text-align: center; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em; font-style: italic;">Production Invite</h1>
                  <p style="text-align: center; color: #6b7280; font-size: 14px; margin-bottom: 32px; text-transform: uppercase; font-weight: bold; letter-spacing: 0.1em;">Drishya Collaborative Filmmaking</p>
                  
                  <div style="border-top: 1px solid #f3f4f6; border-bottom: 1px solid #f3f4f6; padding: 24px 0; margin-bottom: 32px;">
                    <p style="margin-bottom: 16px; font-size: 16px;">Hello,</p>
                    <p style="margin-bottom: 16px; font-size: 16px;">You have been invited to join the production team for <strong>${projectName}</strong> as a <strong>${roleName}</strong>.</p>
                  </div>
                  
                  <div style="text-align: center; margin-bottom: 32px;">
                    <a href="${inviteLink}" style="display: inline-block; background-color: #111827; color: #ffffff; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: 900; font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);">
                      Accept Invitation
                    </a>
                  </div>
                  
                  <p style="font-size: 12px; color: #9ca3af; text-align: center; margin-top: 32px;">
                    If the button above doesn't work, copy and paste this link into your browser:<br>
                    <span style="color: #2563eb; font-weight: bold;">${inviteLink}</span>
                  </p>
                </div>
              </body>
            </html>
          `
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Brevo API Error Details:", errorData);
        return res.status(response.status).json({ 
          error: errorData.message || "Brevo failed to send email",
          code: errorData.code 
        });
      }

      res.json({ success: true, message: "Invite email sent successfully" });
    } catch (error) {
      console.error("Server processing error:", error);
      res.status(500).json({ error: "Failed to process invitation email" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
