# Team Management Tool

A simple web application for managing team events including vacations, sick days, and other employee-related events.

## Features

- Calendar view showing all team events
- Employee management with vacation tracking
- Track multiple event types:
  - Vacation
  - Sick Day
  - Late/Left Early
  - Day Off Paid
  - Day Off Unpaid
  - Start Working
  - Probation Finished
  - Last Day
- Automatic vacation day calculation
- Summary statistics for each employee

## Tech Stack

- Node.js with Express
- PostgreSQL with Prisma ORM
- EJS with ejs-mate for templating
- Docker for database

## Setup

1. Start the PostgreSQL database:
```bash
docker compose up -d
```

2. Install dependencies:
```bash
npm install
```

3. The database is already migrated. If you need to reset or modify the schema, run:
```bash
npx prisma migrate dev
```

4. Start the server:
```bash
npm start
```

Or for development with auto-reload:
```bash
npm run dev
```

5. Open your browser and navigate to:
```
http://localhost:3266
```

## Usage

### Managing Employees

1. Click "Add Employee" to create a new employee
2. Set their name, email, start date, and vacation allowance
3. View employee details to see vacation summary and all events
4. Edit or delete employees as needed

### Managing Events

1. Click "Add Event" or use the calendar navigation
2. Select employee, event type, and dates
3. Events appear on the calendar with color coding
4. Click on events to view details, edit, or delete

### Calendar Navigation

- Use "Previous" and "Next" to navigate months
- Click "Today" to return to current month
- Events are color-coded by type for easy identification

## Database Port

The PostgreSQL database runs on port 5098 (mapped from container port 5432).

Connection string: `postgresql://teamadmin:teampass123@localhost:5098/team_management`

## Vacation Tracking

The system automatically calculates:
- Total vacation days taken in current year
- Remaining vacation days
- Days are calculated for multi-day vacation periods

## Project Structure

```
teamManagement/
├── prisma/
│   └── schema.prisma          # Database schema
├── public/
│   └── css/
│       └── style.css          # Styles
├── routes/
│   ├── employees.js           # Employee routes
│   └── events.js              # Event routes
├── views/
│   ├── layouts/
│   │   └── boilerplate.ejs    # Main layout
│   ├── employees/             # Employee views
│   └── events/                # Event views
├── server.js                  # Main server file
├── docker-compose.yml         # Docker configuration
└── package.json               # Dependencies
```
