# Belly n Bloom on Vercel

Structure: `public/` is the website, `api/submit.js` saves answers, `api/admin.js` is the password-protected results page (`/admin`), `lib/` is shared code.

## 1. Put it on Vercel (pick one)
**A. GitHub (recommended)**
1. Create a private GitHub repo and upload everything in this folder (not `node_modules`).
2. vercel.com > **Add New > Project** > import the repo > **Deploy**. No settings to change.

**B. Vercel CLI (no GitHub)**
```
npm i -g vercel
cd belly-n-bloom-vercel
vercel          # first time: log in, accept defaults
vercel --prod
```

## 2. Database (so answers are stored)
Project > **Storage** > **Create / Marketplace > Upstash Redis** (free tier) > connect to this project. Vercel adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` by itself.

## 3. Environment variables
Project > **Settings > Environment Variables** (see `.env.example`):
| Name | Value |
| --- | --- |
| `ADMIN_PASSWORD` | a long password for /admin |
| `MAIL_TO` | where copies go, e.g. projects_us@vaanipureventures.com (commas for more) |
| `SMTP_USER` | a Hostinger mailbox, e.g. surveys@yourdomain.com (hPanel > Emails) |
| `SMTP_PASS` | that mailbox's password |

Then **Deployments > Redeploy** so the new variables load.

## 4. Use your Hostinger domain
1. Project > **Settings > Domains** > add `yourdomain.com` (and `www.yourdomain.com`). Vercel shows the exact DNS records to use.
2. Hostinger hPanel > **Domains > DNS / Nameservers > DNS Zone** and set what Vercel shows. Usually: `A` record, name `@`, value `76.76.21.21`; `CNAME` record, name `www`, value `cname.vercel-dns.com`. Delete the old `A` (and `AAAA`) record for `@` first.
3. Do **not** change the nameservers and do **not** touch `MX` records, or your Hostinger email stops working.
4. Wait 5 to 60 minutes. Vercel issues the HTTPS certificate itself.

## 5. Links
- Home: `https://yourdomain.com/`
- Send to doctors: `https://yourdomain.com/review`
- Results: `https://yourdomain.com/admin`

## 6. Test once live
1. Open `/review` on a phone, tick the box, answer a few questions, add a name and email, **Send my answers**.
2. Check the email arrived (and Spam once).
3. Log in at `/admin`: the response is there. Download the CSV.

## Notes
- Each response is saved in Redis and emailed. If the database is down, the email is the copy; if both fail, the page shows a copy-and-email box so nothing is lost.
- Download the JSON backup from /admin every few days.
- The confidentiality tick is an acknowledgment, not a lock (the concept text is in the page source). For real privacy, turn on Vercel **Deployment Protection / password protection** or add a password in front of `/review`.
- Vercel's free Hobby plan is for personal, non-commercial use only. A company project like this needs the Pro plan (about $20 per month per user).
