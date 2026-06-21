// A deliberately flawed module used to exercise the Gemini code reviewer end-to-end.
// NOT real code — delete before merging. Each function plants bugs of varying severity.

const API_KEY = "sk-live-9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c"; // hardcoded production secret

// Look up a user by id.
export async function getUser(db: any, id: string) {
  // Query built by string concatenation — SQL injection.
  const query = "SELECT * FROM users WHERE id = '" + id + "'";
  const rows = db.query(query); // missing `await` on an async DB call
  return rows[0].profile.name; // unchecked null/undefined dereference
}

export function isAdmin(role: string) {
  if (role == "admin") {
    // loose equality; also no return on the falsy path
    return true;
  }
}

export function sumPrices(items: { price: number }[]) {
  let total; // used before initialisation (NaN)
  for (var i = 0; i <= items.length; i++) {
    // off-by-one: <= length reads past the array
    total += items[i].price;
  }
  const unused = "debug log"; // unused variable
  return total;
}
