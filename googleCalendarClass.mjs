import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import http from 'http';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import open from 'open';
import destroyer from 'server-destroy';


class GoogleCalendar {
  constructor() {
    this.SCOPES = ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/tasks'];
    this.TOKEN_PATH = path.join(process.cwd(), 'token.json');
    this.CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');
    this.auth = null;
    console.log(`[INIT] Token Path: ${this.TOKEN_PATH}`);
    console.log(`[INIT] Credentials Path: ${this.CREDENTIALS_PATH}`);
  }

  async loadSavedCredentialsIfExist() {
    console.log('[loadSavedCredentialsIfExist] Attempting to load token...');
    try {
      const content = await fs.readFile(this.TOKEN_PATH, 'utf-8');
      const credentials = JSON.parse(content);
      console.log('[loadSavedCredentialsIfExist] Token file read successfully.');

      const client = new OAuth2Client(
        credentials.client_id,
        credentials.client_secret
      );

      client.setCredentials({
        refresh_token: credentials.refresh_token,
      });
      console.log('[loadSavedCredentialsIfExist] Client set with saved credentials.');
      return client;
    } catch (err) {
      return null;
    }
  }
  async saveCredentials(client) {
    console.log('[saveCredentials] Attempting to save credentials...');
    const content = await fs.readFile(this.CREDENTIALS_PATH, 'utf-8');
    const keys = JSON.parse(content).installed;
    console.log('[saveCredentials] Credentials file read for client_id/secret.');

    const payload = {
      type: 'authorized_user',
      client_id: keys.client_id,
      client_secret: keys.client_secret,
      refresh_token: client.credentials.refresh_token,
    };

    await fs.writeFile(this.TOKEN_PATH, JSON.stringify(payload));
  }
  async authenticateManually() {
    console.log('[authenticateManually] Starting manual authentication...');
    const content = await fs.readFile(this.CREDENTIALS_PATH, 'utf-8');
    const keys = JSON.parse(content).installed;
    console.log('[authenticateManually] Credentials loaded from credentials.json.');

    const oAuth2Client = new OAuth2Client(
      keys.client_id,
      keys.client_secret,
      keys.redirect_uris[0]
    );

    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: this.SCOPES,
    });
    console.log(`[authenticateManually] Auth URL generated: ${authUrl}`);

    return new Promise((resolve, reject) => {
      let server; // Declare server outside try block to ensure it's in scope for finally

      const setupServer = () => {
          server = http.createServer(async (req, res) => {
            try {
              if (req.url && req.url.indexOf('/?code=') > -1) {
                const url = new URL(req.url, keys.redirect_uris[0]); // Use correct redirect URI
                const code = url.searchParams.get('code');
                console.log(`[authenticateManually] Received callback code: ${code ? 'YES' : 'NO'}`);
                res.end('Authentication successful! You can close this window.');

                try {
                  const { tokens } = await oAuth2Client.getToken(code);
                  oAuth2Client.setCredentials(tokens);
                  console.log(`[authenticateManually] Tokens received. Refresh token present: ${!!tokens.refresh_token}`);

                  if (!tokens.refresh_token) {
                      console.warn("⚠️ No refresh token received during this authentication. This is normal if you've already granted offline access for these scopes. Ensure token.json is still valid, or delete it to force a new refresh token.");
                  }
                  resolve(oAuth2Client); // Resolve the promise with the authenticated client
                } catch (tokenError) {
                  console.error(`[authenticateManually] ❌ ERROR getting tokens: ${tokenError.message}`);
                  res.writeHead(500);
                  res.end('Authentication failed during token exchange.');
                  reject(tokenError); // Reject the promise on token exchange error
                } finally {
                    if (server) {
                        server.destroy(); // Ensure server is destroyed regardless of token success/failure
                        console.log('[authenticateManually] Local server destroyed.');
                    }
                }
              } else {
                res.writeHead(404);
                res.end('Not Found');
              }
            } catch (error) {
              console.error(`[authenticateManually] ❌ ERROR in server callback: ${error.message}`);
              res.writeHead(500);
              res.end('Server internal error during authentication.');
              if (server) {
                  server.destroy();
              }
              reject(error); // Reject the promise on server callback error
            }
          });

          server.listen(3000, () => {
            console.log('[authenticateManually] Local server listening on http://localhost:3000 for OAuth callback...');
            open(authUrl, { wait: false }).then(cp => cp.unref());
          }).on('error', (err) => { // Handle server start errors
            console.error(`[authenticateManually] ❌ ERROR: Local server failed to start on port 3000: ${err.message}`);
            reject(err); // Reject the promise if server fails to start
          });

          destroyer(server); // Make the server destroyable by server.destroy()
      };

      setupServer();
    });
  }
  async authorize() {
    console.log('[authorize] Starting authorization process...');
    let client = await this.loadSavedCredentialsIfExist();
    if (client) {
      console.log('[authorize] Using saved credentials.');
      return client;
    }

    console.log('[authorize] No saved credentials, performing manual authentication...');
    try {
      client = await this.authenticateManually();
      
      // Only attempt to save if the manual authentication succeeded and returned a client
      if (client && client.credentials && client.credentials.refresh_token) {
        console.log('[authorize] Refresh token received, saving credentials...');
        await this.saveCredentials(client);
      } else {
        // This warning is for cases where manual auth finished but no NEW refresh token was given
        // (e.g., user re-authenticated without revoking access).
        // If token.json doesn't exist AND this is hit, it implies Google didn't give a refresh token.
        console.warn("⚠️ No new refresh token received during this session. 'token.json' will not be created/updated with a new refresh token. This is expected if 'prompt: consent' was not used or if user already granted offline access for these scopes. Ensure previous token.json is valid or proceed if temporary access is sufficient.");
      }
      return client; // Return the client whether or not a refresh token was received/saved
    } catch (err) {
      console.error(`[authorize] ❌ ERROR during manual authentication: ${err.message}`);
      throw err; // Re-throw the error so main() can catch it
    }
  }
  // New: login() method to authenticate and store in this.auth
  async login() {
    this.auth = await this.authorize();
    return this.auth;
  }
  async listEvents(auth) {
    const usedAuth = this.auth || auth;
    if (!usedAuth) throw new Error('No auth client available. Call login() or pass auth.');
    const calendar = google.calendar({ version: 'v3', auth: usedAuth });

    const now = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(now.getDate() + 7);
// 'd16af1522c1855ebb3da9355190697e13ca42d8ff0033da2bee4bde70b4c0bb1@group.calendar.google.com'
    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: now.toISOString(),
      timeMax: nextWeek.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });
    

    const events = res.data.items;
    if (!events || events.length === 0) {
      console.log('No upcoming events found.');
      return;
    }
    const upcomingEvents = {};
    // console.log('Upcoming 1 week of events:');
    events.forEach((event) => {
      const start = event.start.dateTime || event.start.date;
      // console.log(`${start} - ${event.summary}`);
      upcomingEvents[event.start.dateTime || event.start.date] = {summary: event.summary, description: event.description, location: event.location};
    });
    return upcomingEvents;
  }
  async listEventsAI(auth) {
    const usedAuth = this.auth || auth;
    if (!usedAuth) throw new Error('No auth client available. Call login() or pass auth.');
    const calendar = google.calendar({ version: 'v3', auth: usedAuth });

    const now = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(now.getDate() + 7);
// 'd16af1522c1855ebb3da9355190697e13ca42d8ff0033da2bee4bde70b4c0bb1@group.calendar.google.com'
    const res = await calendar.events.list({
      calendarId: 'd16af1522c1855ebb3da9355190697e13ca42d8ff0033da2bee4bde70b4c0bb1@group.calendar.google.com',
      timeMin: now.toISOString(),
      timeMax: nextWeek.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });
    

    const events = res.data.items;
    if (!events || events.length === 0) {
      console.log('No upcoming events found.');
      return;
    }
    const upcomingEvents = {};
    // console.log('Upcoming 1 week of events:');
    events.forEach((event) => {
      const start = event.start.dateTime || event.start.date;
      // console.log(`${start} - ${event.summary}`);
      upcomingEvents[event.start.dateTime || event.start.date] = {summary: event.summary, description: event.description, location: event.location};
    });
    return upcomingEvents;
  }
  async createEvent(auth, event) {
    const usedAuth = this.auth || auth;
    if (!usedAuth) throw new Error('No auth client available. Call login() or pass auth.');
    const calendar = google.calendar({ version: 'v3', auth: usedAuth });
    // example event
    // const event = {
    //   summary: 'Meet Node.js Expert',
    //   location: 'Online',
    //   description: 'Discuss calendar integration',
    //   start: {
    //     dateTime: '2025-07-16T10:00:00+02:00',
    //     timeZone: 'Europe/Prague',
    //   },
    //   end: {
    //     dateTime: '2025-07-16T11:00:00+02:00',
    //     timeZone: 'Europe/Prague',
    //   },
    //   colorId: '5',
    // };

    const res = await calendar.events.insert({
      calendarId: 'd16af1522c1855ebb3da9355190697e13ca42d8ff0033da2bee4bde70b4c0bb1@group.calendar.google.com',
      requestBody: event,
    });

    console.log('✅ Event created:');
    return 200;
    console.log(res.data.htmlLink);
  }
  async createEvents(auth, events) {
    if(events === 'plan already created') {
      console.log('Plan already created, skipping event creation');
      return 200;
    }
    const usedAuth = this.auth || auth;
    if (!usedAuth) throw new Error('No auth client available. Call login() or pass auth.');
    const calendar = google.calendar({ version: 'v3', auth: usedAuth });
    // example event
    // const event = {
    //   summary: 'Meet Node.js Expert',
    //   location: 'Online',
    //   description: 'Discuss calendar integration',
    //   start: {
    //     dateTime: '2025-07-16T10:00:00+02:00',
    //     timeZone: 'Europe/Prague',
    //   },
    //   end: {
    //     dateTime: '2025-07-16T11:00:00+02:00',
    //     timeZone: 'Europe/Prague',
    //   },
    //   colorId: '5',
    // };
    let eventsObject = JSON.parse(events);
    console.log('creating an event object',eventsObject);
    eventsObject.forEach(async (event) => {
      const res = await calendar.events.insert({
        calendarId: 'd16af1522c1855ebb3da9355190697e13ca42d8ff0033da2bee4bde70b4c0bb1@group.calendar.google.com',
        requestBody: event,
      });
      console.log(`event ${event.summary} inserted`);
    })
    console.log('[createEvents] ✅ Event created:');
    return 200;
    console.log(res.data.htmlLink);
  }
  async createTask(auth, task) {
    const usedAuth = this.auth || auth;
    if (!usedAuth) {
        console.error('[createTask] No auth client available.');
        throw new Error('No auth client available. Call login() first.');
    }
    const tasksApi = google.tasks({ version: 'v1', auth: usedAuth });
    // const task = {
    //   title: taskDetails.title,
    //   notes: taskDetails.notes || '',
    //   due: taskDetails.due, // This should be an RFC 3339 date-time, e.g., '2025-07-25T17:00:00.000Z'
    //   status: taskDetails.status || 'needsAction', // Can be 'needsAction' or 'completed'
    //   // You can also add parent, position, etc.
    // };
    try {
      const res = await tasksApi.tasks.insert({
        tasklist: 'SEVaT3Mta1hvdUhwNzNsbg',
        requestBody: task
      });
      console.log('[createTask] task succesfuly inserted');
      
    }
    catch (err){
      console.error(`[createTask] ❌ Error creating task in task list "${tasklistId}": ${err.message}`);
      throw err;
    }
  }
  async createTasks(auth, tasks) {
    const usedAuth = this.auth || auth;
    if (!usedAuth) {
        console.error('[createTask] No auth client available.');
        throw new Error('No auth client available. Call login() first.');
    }
    const tasksApi = google.tasks({ version: 'v1', auth: usedAuth });
    // const task = {
    //   title: taskDetails.title,
    //   notes: taskDetails.notes || '',
    //   due: taskDetails.due, // This should be an RFC 3339 date-time, e.g., '2025-07-25T17:00:00.000Z'
    //   status: taskDetails.status || 'needsAction', // Can be 'needsAction' or 'completed'
    //   // You can also add parent, position, etc.
    // };
    try {
      let tasksObject = JSON.parse(tasks)
      tasksObject.forEach(async (task) => {
        let res = await tasksApi.tasks.insert({
          tasklist: 'SEVaT3Mta1hvdUhwNzNsbg',
          requestBody: task
        });
      })

      console.log('[createTask] tasks succesfuly inserted to SEVaT3Mta1hvdUhwNzNsbg');
      
    }
    catch (err){
      console.error(`[createTask] ❌ Error creating task in task list "${tasklistId}": ${err.message}`);
      throw err;
    }
  }
  async listCalendars(auth) {
    const usedAuth = this.auth || auth;
    if (!usedAuth) throw new Error('[listCalendars] No auth client available. Call login() or pass auth.');
    const calendar = google.calendar({ version: 'v3', auth: usedAuth });
    const res = await calendar.calendarList.list();
    res.data.items.forEach(cal => {
      console.log(`${cal.summary} (ID: ${cal.id})`);
    });
  }
  async listTasks(auth) {
    const usedAuth = this.auth || auth;
    if (!usedAuth) throw new Error('[listTasks] No auth client available. Call login() or pass auth.');
    const tasksApi = google.tasks({ version: 'v1', auth: this.auth });
    try {
      const res = await tasksApi.tasks.list({ tasklist: 'SEVaT3Mta1hvdUhwNzNsbg' });
      const tasks = res.data.items;
      if (!tasks || tasks.length === 0) {
        console.log('No tasks found.');
        return [];
      }
      console.log('--- Google Tasks ---');
      let tasksFormed = {};
      tasks.forEach((task) => {
        console.log(`- ${task.title} (Due: ${task.due || 'N/A'}, Status: ${task.status}, ID: ${task.id})`);
        tasksFormed[task.title] = {notes: task.notes, due: task.due, status: task.status, completed: task.completed};
      })

      console.log('---------------------');
      return tasksFormed;
    }
    catch (err) {
      console.error(`[listTasks] ❌ Error listing tasks: ${err.message}`);
      throw err;
    }

  }
  async listTaskLists() {
    const usedAuth = this.auth;
    if (!usedAuth) {
        console.error('[listTaskLists] No auth client available.');
        throw new Error('No auth client available. Call login() first.');
    }
    const tasksApi = google.tasks({ version: 'v1', auth: usedAuth });

    try {
      const res = await tasksApi.tasklists.list();
      const taskLists = res.data.items;

      if (!taskLists || taskLists.length === 0) {
        console.log('No task lists found.');
        return [];
      }

      console.log('--- Google Task Lists ---');
      taskLists.forEach((list) => {
        console.log(`${list.title} (ID: ${list.id})`);
      });
      console.log('-------------------------');
      return taskLists;
    } catch (err) {
      console.error(`[listTaskLists] ❌ Error listing task lists: ${err.message}`);
      throw err;
    }
  }
  async main() {
    try {
      await this.login();
      await this.listEvents();
      await this.listTasks();
      
      // await this.createEvent();
    } catch (err) {
      console.error('❌ Error:', err.message);
    }
  }
}

let gc = new GoogleCalendar();
await gc.main();
export default GoogleCalendar;
