import cds from "@sap/cds";
import { loggedMethod, traceAsyncFn, traceAsyncFunction } from "./tracing.js";

class BooksService extends cds.ApplicationService {
  async init() {
    this.before("READ", "Authors", (req) => {
      console.log("Reading Authors...");
      console.log("Query:", req.query);
    });

    this.after("READ", "Books", async (books) => {
      console.log("Whut whut pizza hut ");

      if (Array.isArray(books)) {
        await this.processBooksArray(books);
      }
      return books;
    });

    return super.init();
  }

  async processBooksArray(books: any[]): Promise<void> {
    for (const book of books) {
      console.log("book", book);
    }
  }
}

export default BooksService;
