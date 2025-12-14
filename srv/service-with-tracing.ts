import cds from "@sap/cds";
import { Traced } from "./otel-dynatrace-setup.js";
import { trace } from "@opentelemetry/api";

/**
 * Enhanced BooksService with Dynatrace Tracing
 *
 * This demonstrates three levels of tracing:
 * 1. Automatic CAP handler tracing (via CAPEventTracer)
 * 2. Manual method tracing (via @Traced decorator)
 * 3. Stack sampling (captures everything, including helper functions)
 */
class BooksService extends cds.ApplicationService {
  async init() {
    // These handlers are automatically traced by CAPEventTracer
    // Spans will appear as: "before:READ:Authors"
    this.before("READ", "Authors", (req) => {
      console.log("Reading Authors...");
      console.log("Query:", req.query);
    });

    // This handler is automatically traced
    // Spans will appear as: "after:READ:Books"
    this.after("READ", "Books", async (books) => {
      console.log("Processing books after READ");

      if (Array.isArray(books)) {
        // This method is manually traced below with @Traced
        await this.processBooksArray(books);
      }
      return books;
    });

    return super.init();
  }

  /**
   * Traced method - will create a span named "BooksService.processBooksArray"
   * All nested function calls are automatically captured by stack sampling
   */
  @Traced()
  async processBooksArray(books: any[]): Promise<void> {
    for (const book of books) {
      // These nested calls are captured by stack sampling
      await this.enrichBookData(book);
      await this.validateBook(book);

      if (book.stock < 10) {
        await this.checkReorderNeeded(book);
      }
    }
  }

  /**
   * Manually traced method for book enrichment
   * This creates a child span under processBooksArray
   */
  @Traced('enrichBookData')
  async enrichBookData(book: any): Promise<void> {
    console.log("Enriching book:", book.title);

    // Simulate some processing
    book.processedAt = new Date().toISOString();

    // Even this nested helper is captured by stack sampling
    this.calculateDiscountPrice(book);
  }

  /**
   * Another traced method
   */
  @Traced('validateBook')
  async validateBook(book: any): Promise<void> {
    if (!book.title || !book.author_ID) {
      throw new Error(`Invalid book: ${book.ID}`);
    }
  }

  /**
   * Business logic method
   */
  @Traced('checkReorderNeeded')
  async checkReorderNeeded(book: any): Promise<void> {
    console.log(`Low stock for ${book.title}: ${book.stock} units`);
    // In real app, this might trigger a reorder workflow
  }

  /**
   * Helper function - automatically captured by stack sampling
   * No @Traced needed, but you can add it for better span names
   */
  private calculateDiscountPrice(book: any): number {
    const discount = book.stock < 5 ? 0.2 : 0.1;
    return book.price * (1 - discount);
  }

  /**
   * Example: Manual span creation for complex logic
   */
  async complexBusinessLogic(data: any): Promise<void> {
    const tracer = trace.getTracer('bookshop-service');

    // Create a parent span
    const parentSpan = tracer.startSpan('complexBusinessLogic');

    try {
      // Create child span for database operations
      const dbSpan = tracer.startSpan('database-operations');
      await this.fetchFromDatabase();
      dbSpan.end();

      // Create child span for external API call
      const apiSpan = tracer.startSpan('external-api-call', {
        attributes: {
          'api.endpoint': '/external/service',
          'api.method': 'GET',
        }
      });
      await this.callExternalAPI();
      apiSpan.end();

    } finally {
      parentSpan.end();
    }
  }

  private async fetchFromDatabase(): Promise<void> {
    // Simulated DB operation
    return new Promise(resolve => setTimeout(resolve, 100));
  }

  private async callExternalAPI(): Promise<void> {
    // Simulated API call
    return new Promise(resolve => setTimeout(resolve, 200));
  }
}

export default BooksService;
