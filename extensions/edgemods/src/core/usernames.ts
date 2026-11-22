// The username rule, as the server has it (packages/server/src/usernames.ts), so the editor can say at once what
// is wrong. The server decides: it also knows which are taken or kept back.
export const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,19}$/;
export const USERNAME_RULE = 'A username is 3 to 20 letters (a to z), digits, - or _, and starts with a letter or a digit.';
