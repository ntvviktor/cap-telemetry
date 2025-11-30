namespace bookshop;

entity Books {
  key ID : Integer;
  title  : String(111);
  stock  : Integer;
  author : Association to Authors;
}

entity Authors {
  key ID : Integer;
  name   : String(111);
  books  : Association to many Books on books.author = $self;
}

entity Orders {
  key ID       : UUID;
  book         : Association to Books;
  quantity     : Integer;
  total        : Decimal(9,2);
  createdAt    : Timestamp;
}
