const ccxt = require('ccxt');
const fs = require('fs');

const MARKET = 'BAT/ETH';
const RATIO = 0.03;
const SELL_MARGIN = 1.03;
const BUY_MARGIN = 0.99;

const idGen = () => (
  (() => (Math.floor((1 + Math.random()) * 0x10000000000000000)
    .toString(16)
    .substring(1)
  ))()
);

const WAITING_FOR_SELL = 'WAITING_FOR_SELL';
const WAITING_FOR_BUY = 'WAITING_FOR_BUY';
const PENDING = 'PENDING';

const AMOUNT = 100;

const sleep = (t) => new Promise((resolve) => {
  setTimeout(resolve, t);
});

const main = async () => {
  const binance = new ccxt.binance({
    apiKey: 'API_KEY',
    secret: 'API_SECRET',
  });

  // const markets = await binance.loadMarkets();

  const ticker = await binance.fetchTicker(MARKET);
  const pending = (await binance.fetchOpenOrders('BAT/ETH')).reduce(
    (r, o) => { r[o.id] = true; return r; }, {}
  );

  let account;
  if (!fs.existsSync('./account.json')) {
    account = {
      operations: {},
      history: [],
      last: ticker.last,
    };
  } else {
    account = JSON.parse(fs.readFileSync('./account.json'));
  }

  console.log(`Current price: ${ticker.last}`);
  console.log(`Last price: ${account.last}`);
  console.log();

  let rangeOutNum = 0;

  class Operation {
    constructor({ id, price, action, count, status, oid, prev, timestamp, amount }) {
      this.id = id || idGen();
      this.price = price || 99999999999;
      this.action = action || 'sell';
      this.count = count || 0;
      this.status = status || WAITING_FOR_BUY;
      this.oid = oid || '9999999';
      this.timestamp = timestamp || 0;
      this.amount = amount || AMOUNT;
      this.prev = prev || {};

      console.log(`Operation: ${this.id}`);
      console.log(`Status: ${this.status}`);
    }
    async start() {
      console.log(`Last action: ${this.action} at ${this.price}`);

      if (
        (ticker.last / this.price) <= 0.92 ||
        (ticker.last / this.price) >= 1.08
      ) {
        rangeOutNum += 1;
      }

      if (this.status === PENDING && pending[this.oid]) {
        return;
      } else if (this.status === PENDING && this.action === 'buy') {
        this.status = WAITING_FOR_SELL;
      } else if (this.status === PENDING && this.action === 'sell') {
        this.status = WAITING_FOR_BUY;
      }

      if (this.action === 'buy') {
        await this.sell();
      } else if (this.action === 'sell') {
        await this.buy();
      }
    }
    backup() {
      this.prev = {
        count: this.count,
        status: this.status,
        action: this.action,
        price: this.price,
        amount: this.amount,
      }
    }
    async buy() {
      if (
        (ticker.last / this.price) < BUY_MARGIN &&
        ticker.last > account.last
      ) {
        this.backup();

        this.oid = (await binance.create_limit_buy_order(MARKET, this.amount, ticker.last)).id;
        this.price = account.last;
        this.count += 1;
        this.action = 'buy';
        this.status = PENDING;
        this.timestamp = (new Date()).getTime();
        await sleep(3000);
      } else {
        console.log(`Wait for price less than ${this.price * BUY_MARGIN} to buy`);
      }
    }
    async sell() {
      if (
        (ticker.last / this.price) > SELL_MARGIN &&
        ticker.last < account.last
      ) {
        this.backup();

        this.oid = (await binance.create_limit_sell_order(MARKET, this.amount, ticker.last)).id;
        this.action = 'sell';
        this.price = account.last;
        this.count += 1;
        this.status = PENDING;
        this.timestamp = (new Date()).getTime();
        await sleep(2000);
      } else {
        console.log(`Wait for price much than ${this.price * SELL_MARGIN} to sell`);
      }
    }
    async save() {
      // console.log((new Date()).getTime() - this.timestamp);
      if (
        this.status === PENDING &&
        ((new Date()).getTime() - this.timestamp) > 300000
      ) {
        await binance.cancelOrder(this.oid, 'BAT/ETH');
        this.count = this.prev.count;
        this.status = this.prev.status;
        this.action = this.prev.action;
        this.price = this.prev.price;
        this.amount = this.prev.amount;
      }

      account.operations[this.id] = {
        id: this.id,
        count: this.count,
        status: this.status,
        action: this.action,
        price: this.price,
        oid: this.oid,
        timestamp: this.timestamp,
        amount: this.amount,
        prev: this.prev,
      }
      console.log();
    }
  };


  for (let i in account.operations) {
    const operation = new Operation(account.operations[i]);
    await operation.start();
    await operation.save();
  }

  if (rangeOutNum >= account.operations.length) {
    const operation = new Operation({});
    await operation.start();
    await operation.save();
  }

  account.last = ticker.last;

  const stream = fs.createWriteStream('account.json');
  stream.write(JSON.stringify(account));
};

main();
