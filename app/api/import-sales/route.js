const customerCode = clean(
  findValue(row, [
    "Customer Code",
    "CustomerCode",
    "Party Code",
  ])
);

const customerName = clean(
  findValue(row, [
    "Customer Name",
    "Customer",
    "Party Name",
  ])
);
