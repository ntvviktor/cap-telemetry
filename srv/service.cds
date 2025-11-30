using { bookshop } from '../db/schema';

service BooksService {
  entity Books as projection on bookshop.Books;
  entity Authors as projection on bookshop.Authors;
  entity Orders as projection on bookshop.Orders;
}
