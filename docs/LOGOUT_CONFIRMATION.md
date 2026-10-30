# Confirm before logging out

Both apps ask **Log out of SafeWatch?** before ending the session. The dialog
matches the existing green Nature Glass interface and contains **Cancel** and
**Confirm** buttons. Cancel receives initial keyboard focus. Cancel or Escape
closes the dialog without making a sign-out request. Only Confirm signs out.

The shared dialog covers the admin sidebar and account menu, the family Profile
button, and the account-access and verification sign-out actions. It keeps the
existing sign-out scope for each action. Declining privacy terms and returning
from password recovery retain their existing explicit flows.

While confirmation is being submitted, both buttons are disabled, repeated
clicks cannot submit twice, and Escape cannot dismiss the pending operation.
Failure keeps the dialog open with a retry message. Successful logout returns
to login using the existing authentication and private-cache cleanup.

No database migration is needed. Production builds and synthetic browser checks
cover cancellation, Escape, both admin entry points, failure/retry, repeated
clicks, confirmed logout, keyboard focus, and the family layout on a phone.
Testing does not sign out real users.
