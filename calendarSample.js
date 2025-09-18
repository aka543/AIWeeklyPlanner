import dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

console.log('Calendar ID:', process.env.CALENDAR_ID);
console.log('Service Account Key:', process.env.SERVICE_ACCOUNT_KEY ? 'Loaded' : 'Not Loaded');
const credentials = JSON.parse(process.env.SERVICE_ACCOUNT_KEY);
console.log('Google Client Email:', credentials.client_email);
console.log('Private Key ID:', credentials.private_key_id);

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

async function authenticate() {
  const auth = new google.auth.GoogleAuth({
    credentials: credentials,
    scopes: SCOPES,
  });

  const client = await auth.getClient();
  return client;
}

async function listEvents() {
  try {
    const client = await authenticate();
    const calendar = google.calendar({ version: 'v3', auth: client });
    const res = await calendar.events.list({
      calendarId: process.env.CALENDAR_ID,
      timeMin: (new Date()).toISOString(),
      maxResults: 10,
      singleEvents: true,
      orderBy: 'startTime',
    });
    const events = res.data.items;
    if (!events || events.length === 0) {
      console.log('No upcoming events found.');
      return;
    }
    console.log('Upcoming 10 events:');
    events.map((event) => {
      const start = event.start.dateTime || event.start.date;
      console.log(`${start} - ${event.summary}`);
    });
  } catch (error) {
    console.error('Error listing events:', error);
  }
}

listEvents();