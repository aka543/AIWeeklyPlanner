import axios from 'axios';
import  OpenAI  from 'openai';
import Bakalari from './bakalari.mjs';
import GoogleCalendar from './googleCalendarClass.mjs';
import fs from 'fs';
import dotenv from 'dotenv';
import { time } from 'console';
dotenv.config();
// Bakalari API
const bakalari = new Bakalari();
await bakalari.login();
const timetableInfo = await bakalari.getTimetableInfoActual();
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
// Google Calendar API
let gc = new GoogleCalendar();
await gc.login();
const events = await gc.listEvents();
const eventsAI = await gc.listEventsAI();
await gc.listCalendars();
console.log(JSON.stringify(events));
console.log(JSON.stringify(timetableInfo));
let tasks = await gc.listTasks();
console.log('tasks: ',tasks);
let hobbies = `I like to ride a bike, especcialy some downhill riding, trails. 
I do judo. In normal school year I have trainings on Tuesday on 16:00 on wednesday 
I have to go to a training on 17:10. On Thursday I have training on 17:00 and its two hours long. 
On friday i have just one hour training on 16:00. 
And sometimes I have trainings on sunday on like 18:15 when I dont have ant tournament or plans. 
I also like programming. And the training are only when there isnt any holiday or pause. 
I also like going to the gym or hanging out with my friends if they have time and i also have time.`
// Chat GPT API
const today = new Date();
const dayName = today.toLocaleDateString('en-US', { weekday: 'long' });

console.log(dayName);

const inputText = `Create me a weekly plan for the following timetable: ${JSON.stringify(timetableInfo)}, 
and for the following events: ${JSON.stringify(events)}. 
Also be avare of these hobbies: ${hobbies}. 
make the response short if possible and readable. And also include the time of the event in the response(at least a guess). 
Do the response like for each day the program. And for each activity a guess time. Include the events from calendar to the plan.
 And make the plan more free so make there a time space for some relax sometimes(but not often).
 Also if today is ${dayName} and the date is ${new Date().getDate()} include date for each day. 
 And for example if today is wednesdat make the plan just to the sunday. Also if i have some event in calendar on some time, sort the plans for the day by time. 
 So if the event is on 10:00 and you will think of some activity on 11:00 the activity will be after the event\n. 
 Also take into consideration my tasks: ${JSON.stringify(tasks)}, but if these dont make sense to you because its just the title or something like this then just ignore it
 You are an AI assistant in node js project i have created. 
 I have connecrted google calendar to this project so you will give an array of objects in form of JSON that i will input into this function:
    async createEvents(auth, events) {
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
      events.forEach(async (event) => {
        const res = await calendar.events.insert({
          calendarId: 'myCalendarID :)',
          requestBody: event,
        });
      })
      console.log('✅ Event created:');
      return 200;
      console.log(res.data.htmlLink);
    }
    And I have also connected google tasks api with this function:
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
        console.error('error in creating tasks');
        throw err;
      }
    }
    So make the plan not too full so my calendar will not be overfilled. 
    OUTPUT JUST JSON OBJECT WHERE THERE WILL BE KEY: 'calendar' 
    AND VALUE WILL BE THE EVENTS AND ANOTHER KEY: 'tasks' WITH VALUE AS THE TASKS IN PROPER FORM.
    Please in the tasks object include just tasks for school, like if I have some bigger test, 
    I need to teach. Im not teaching long so just like one or two days each like 20mins. 
    nothing else please. not something like here you go: bla bla bla. And do not include the ` + "```json" + ` and ` + "```" + ` tags. Just the JSON object.
    If the plan is already created: ${JSON.stringify(eventsAI)} return JUST 'plan already created' and do not create the plan again.`;

const res = await client.responses.create({
  model: "gpt-4.1",
  input: inputText,
});

console.log(res.output_text);
let outputTextCalendar = JSON.parse(res.output_text).calendar
let outputTextTasks = JSON.parse(res.output_text).tasks
const response = await gc.createEvents(null, JSON.stringify(outputTextCalendar));
const response2 = await gc.createTasks(null, JSON.stringify(outputTextTasks));
console.log(response)
console.log(response2)