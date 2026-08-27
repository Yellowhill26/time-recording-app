# D.Pawson & Sons Time Recording App

Railway-ready production MVP.

## Features
- Employee phone page with no employee password
- Secure one-time device pairing
- Clock in/out and breaks
- Employee overtime submission
- Manager overtime approve/reject
- Manager dashboard
- Six starter employees
- Per-day automatic finish times (Friday defaults to 14:00)
- Annual leave
- 40-hour weekly target
- Weekly review and CSV export
- PostgreSQL persistence and audit log

## Railway setup
1. Upload all files in this package to GitHub.
2. Create a Railway service from that repository.
3. Add PostgreSQL to the same Railway project.
4. Add app variables: NODE_ENV=production, SESSION_SECRET=<long random value>, ADMIN_EMAIL=<manager email>, ADMIN_PASSWORD=<strong password>, ADMIN_NAME=Manager.
5. Ensure DATABASE_URL is available to the app service from the PostgreSQL service.
6. Deploy, then test /manager and /employee on Railway's temporary HTTPS address before connecting the custom domain.

Do not place passwords or database credentials in GitHub.
