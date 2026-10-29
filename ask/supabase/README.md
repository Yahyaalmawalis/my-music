# Connecting Whisper to Supabase

Until `ask/config.js` has your project URL and key, the site runs in local demo
mode (questions stay in each visitor's browser). These steps take about 5 minutes.

1. **Create the project.** Go to https://supabase.com, sign in, click
   **New project**, pick a name (e.g. `whisper`) and a region close to you.
2. **Create the tables and rules.** In the project, open **SQL Editor → New query**,
   paste all of `schema.sql`, and click **Run**.
3. **Create your owner account.** Open **Authentication → Users → Add user →
   Create new user**. Enter your email and a password and tick **Auto Confirm User**.
4. **Make that account the owner.** Back in the SQL Editor, run the last statement
   of `schema.sql` with your email in place of `YOUR_EMAIL_HERE`.
5. **Turn off public sign-ups.** **Authentication → Sign In / Providers → Email**:
   switch off **Allow new users to sign up**. (The database rules already block
   non-owners, this just keeps strangers from creating accounts.)
6. **Copy the keys.** **Project Settings → API** (or the **Connect** button):
   copy the **Project URL** and the **publishable / anon public** key into
   `ask/config.js`. Never use the `service_role` / secret key.
7. Commit and push. Sign in on the site with the email and password from step 3.

## What the rules allow

| Who            | Can                                                        |
| -------------- | ---------------------------------------------------------- |
| Any visitor    | Send a question (text only), read answered questions, read the profile |
| You, signed in | Read every question, answer, archive, restore, delete, edit the profile |

Visitors never see unanswered questions, and the counts on the profile come from a
read-only function, so nothing private leaks through the stats either.
