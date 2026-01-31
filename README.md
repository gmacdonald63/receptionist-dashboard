# AI Receptionist Dashboard

A professional, mobile-responsive dashboard for managing AI voice receptionist services.

## Features

- 📊 **Overview Dashboard** - Real-time stats for calls, appointments, minutes, and billing
- 📅 **Appointments Management** - View and manage all scheduled appointments
- 📞 **Call Logs** - Searchable call history with recordings and transcripts
- 📝 **Transcripts** - Full conversation transcripts with AI/caller differentiation
- 💰 **Billing** - Track usage and billing history
- ⚙️ **Settings** - Configure greetings, business hours, and integrations

## Tech Stack

- **React 18** - Modern React with hooks
- **Vite** - Lightning-fast build tool
- **Tailwind CSS** - Utility-first styling
- **Lucide React** - Beautiful icon library

## Getting Started

### Run on StackBlitz (Recommended)

1. Go to https://stackblitz.com
2. Click "Import project" or "New Project"
3. Upload this entire folder or paste the GitHub URL
4. The project will automatically install dependencies and start!

### Run Locally

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Project Structure

```
receptionist-dashboard/
├── src/
│   ├── App.jsx          # Main dashboard component
│   ├── main.jsx         # React entry point
│   └── index.css        # Global styles with Tailwind
├── index.html           # HTML entry point
├── package.json         # Dependencies and scripts
├── vite.config.js       # Vite configuration
├── tailwind.config.js   # Tailwind configuration
└── postcss.config.js    # PostCSS configuration
```

## Next Steps

### Connect Real Data

Currently using sample data. To connect to Retell AI and Cal.com:

1. **Add API Integration**
   - Create a services folder for API calls
   - Use fetch or axios to connect to Retell and Cal.com APIs
   - Replace sample data with real API responses

2. **Add Authentication**
   - Implement login system
   - Add user sessions
   - Secure API calls with tokens

3. **Deploy to Production**
   - Use Vercel, Netlify, or similar
   - Set up environment variables for API keys
   - Configure custom domain

## Customization

### Colors
Edit `tailwind.config.js` to change the color scheme

### Data
Replace sample data in `App.jsx` with your API calls

### Features
Add new sections by creating additional render functions and nav items

## Support

For questions or issues, refer to:
- [React Documentation](https://react.dev)
- [Vite Documentation](https://vitejs.dev)
- [Tailwind CSS Documentation](https://tailwindcss.com)

---

Built with ❤️ for AI voice receptionist services
