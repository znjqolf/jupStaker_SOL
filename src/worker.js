const Logger = require("@youpaichris/logger");
const logger = new Logger();
const anchor = require("@coral-xyz/anchor");
const {
  Keypair,
  PublicKey,
  Message,
  VersionedTransaction,
  sendAndConfirmTransaction,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  LAMPORTS_PER_SOL,
  SYSVAR_CLOCK_PUBKEY,
} = require("@solana/web3.js");
const dotenv = require("dotenv");
dotenv.config();
const TYPE = parseInt(process.env.TYPE) || 1;
const Amount =
  new anchor.BN(parseFloat(process.env.AMOUNT) * 1e6) || new anchor.BN(0);
const UNIT_PRICE =
  parseFloat(process.env.UNIT_PRICE) * LAMPORTS_PER_SOL || 100000;
const {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  MintLayout,
  createInitializeMintInstruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddress,
} = require("@solana/spl-token");

// //导入 idl.json (import)
const idl = require("./idl.json");
const governIDL = require("./IDLGOV.json");
const locked_voter = new PublicKey(
  "voTpe3tHQ7AjQHMapgSue2HJFAh2cGsdokqN3XqmVSj"
);

//投票链接 (Voting link) https://vote.jup.ag/proposal/5N9UbMGzga3SL8Rq7qDZCGfZX3FRDUhgqkSY2ksQjg8r
//再改下 投票id 就行了 (Just change the voting id again)
const proposalId = new PublicKey(
  "CioyJmzFuRbN3Pda1LhvNxsEDoA4gQfTJ56F2hgWib5C"
);
const voteId = 2;
const jupAddress = new PublicKey("JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN");
const locker = new PublicKey("CVMdMd79no569tjc5Sq7kzz8isbfCcFyBS5TLGsrZ5dN");
//此处 (here) locker 是 由 (Is caused by) bJ1TRoFo2P6UHVwqdiipp6Qhp2HaaHpLowZ5LHet8Gm (未知)和 ((Unknown) and) voTpe3tHQ7AjQHMapgSue2HJFAh2cGsdokqN3XqmVSj (质押地址)计算得出的 ((Stake address) calculated)
// function deriveLocker() {
//   const basePublic = new PublicKey(
//     "bJ1TRoFo2P6UHVwqdiipp6Qhp2HaaHpLowZ5LHet8Gm"
//   );
//   const locked_voter = new PublicKey(
//     "voTpe3tHQ7AjQHMapgSue2HJFAh2cGsdokqN3XqmVSj"
//   );
//   return PublicKey.findProgramAddressSync(
//     [Buffer.from("Locker"), basePublic.toBytes()],
//     locked_voter
//   );
// }
//未知作用 (Unknown effect)
// const SmartWallet = new PublicKey(
//   "GYxjWMU9Bp2o3psFNFnhEZTYsHTE24WQuSU6iGrLZ9EZ"
// );
// function deriveSmartWallet() {
//   const basePublic = new PublicKey(
//     "bJ1TRoFo2P6UHVwqdiipp6Qhp2HaaHpLowZ5LHet8Gm"
//   );
//   const smart = new PublicKey("smaK3fwkA7ubbxEhsimp1iqPTzfS4MBsNL77QLABZP6");
//   return PublicKey.findProgramAddressSync(
//     [Buffer.from("SmartWallet"), basePublic.toBytes()],
//     smart
//   );
// }
const governor = new PublicKey("EZjEbaSd1KrTUKHNGhyHj42PxnoK742aGaNNqb9Rcpgu");
// function deriveGovern() {
//   const basePublic = new PublicKey(
//     "bJ1TRoFo2P6UHVwqdiipp6Qhp2HaaHpLowZ5LHet8Gm"
//   );
const Governor = new PublicKey("GovaE4iu227srtG2s3tZzB4RmWBzw8sTwrCLZz7kN7rY");
//   return m.rV.PublicKey.findProgramAddressSync(
//     [Buffer.from("Governor"), basePublic.toBytes()],
//     Governor
//   );
// }

async function getWallet(privateKey) {
  const MyKeyPair = Keypair.fromSecretKey(
    anchor.utils.bytes.bs58.decode(privateKey)
  );
  const wallet = new anchor.Wallet(MyKeyPair);
  return wallet;
}

function deriveEscrow(e, t, a) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("Escrow"), e.toBytes(), t.toBytes()],
    a
  );
}

function deriveVote(e, t) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("Vote"), t.toBytes(), e.toBytes()],
    Governor
  );
}

class Worker {
  constructor(index, rpc, privateKey) {
    this.privateKey = privateKey;
    this.index = index;
    this.rpc = rpc;
  }

  async work() {
    const balance = await this.checkBalance(this.wallet.publicKey);
    let stakeAmount = Amount;

    if (balance && balance < 0.003 * LAMPORTS_PER_SOL) {
      logger.error(`${this.wallet.publicKey.toBase58()} Insufficient balance`);
    }
    if (TYPE === 1) {
      //获取jupAddress 的余额 (Get the balance of jupAddress)
      const jupBalance = await this.checkTokenBalance(this.wallet.publicKey);
      if (jupBalance === 0) {
        logger.error(
          `${this.wallet.publicKey.toBase58()} Insufficient jup balance`
        );
        return false;
      }

      //如果 Amount 为 0 则质押所有余额 (If Amount is zero, stake all balance)
      if (Amount.isZero()) {
        stakeAmount =
          new anchor.BN(parseFloat(jupBalance) * 1e6) || new anchor.BN(0);
      }
      if (stakeAmount.isZero()) {
        logger.error(
          `第${this.index} 子进程 质押金额 为0 错误 (The deposit amount of the child process is 0 error)`
        );
        return false;
      }
    }

    let successCount = 0;
    let counts = 0;

    while (successCount < 1) {
      let success;
      if (TYPE === 1) {
        success = await this.stake(stakeAmount);
      } else if(TYPE === 2){
        success = await this.vote();
      } else if(TYPE === 3){
        success = await this.unStake();
      }else{
        success = await this.withdraw();
      }
      if (!success) {
        logger.error(
          `第${
            this.index
          } 子进程 地址 (Child process address):${this.wallet.publicKey.toBase58()} ${
            TYPE === 1 ? "质押 (stake)" : "投票 (vote)"
          }失败 重试... (Failed to retry...)`
        );
        counts++;
        logger.error(`Try ${counts} finished`);
        if (counts > 15) {
          // 15 = amount of tries for each wallet
          logger.error(`counts >15`);
          successCount++;
          return false;
        }
      } else {
        successCount++;
        return true;
      }
    }
  }

  async getOrCreateATAInstruction(e, t, a) {
    let r,
      n = arguments.length > 3 && void 0 !== arguments[3] && arguments[3],
      s = arguments.length > 4 && void 0 !== arguments[4] ? arguments[4] : t;
    try {
      r = await getAssociatedTokenAddress(e, t, n);

      let i = await a.getAccountInfo(r);
      if (!i) {
        let a = createAssociatedTokenAccountInstruction(s, r, t, e);
        return [r, a];
      }
      return [r, void 0];
    } catch (e) {
      throw (console.error("Error::getOrCreateATAInstruction", e), e);
    }
  }

  async getOrCreateEscrow() {
    let t = locker;
    let {
        provider: { wallet: e },
        program: a,
      } = this,
      [r, o] = deriveEscrow(t, e.publicKey, locked_voter);
    try {
      return await a.account.escrow.fetch(r), [r, null];
    } catch (n) {
      let o = await a.methods
        .newEscrow()
        .accounts({
          escrow: r,
          escrowOwner: e.publicKey,
          locker: t,
          payer: e.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      return [r, o];
    }
  }

  async stake(stakeAmount) {
    try {
      let {
        wallet,
        provider: { connection },
      } = this;

      let [c, u] = await this.getOrCreateEscrow(),
        [d, p] = await this.getOrCreateATAInstruction(
          jupAddress,
          c,
          connection,
          !0,
          wallet.publicKey
        ),
        [y, h] = await this.getOrCreateATAInstruction(
          jupAddress,
          wallet.publicKey,
          connection,
          !0,
          wallet.publicKey
        ),
        g = [u, p, h].filter(Boolean),
        v = this.program.methods.increaseLockedAmount(stakeAmount).accounts({
          escrow: c,
          escrowTokens: d,
          locker: locker,
          payer: wallet.publicKey,
          sourceTokens: y,
          tokenProgram: TOKEN_PROGRAM_ID,
        });

      let instruction = await v.instruction();

      let signature = await this.toggleMaxDuration(!0, [...g], [instruction]);

      if (signature) {
        logger.success(
          `第${
            this.index
          } 子进程 (Child process) ${this.wallet.publicKey.toBase58()} 质押成功 (Successful stake) ${signature}`
        );
        return true;
      } else {
        logger.error(
          `第${
            this.index
          } 子进程 (Child process) ${this.wallet.publicKey.toBase58()} 质押失败 (stake failed)`
        );
        return false;
      }
    } catch (error) {
      logger.error(`交易 (transaction) Error: ${error.message}`);
      // 如果(if) program error: 0x1 在报错中 则返回真(Returns true if an error is reported.) 因为这样该账号无论如何都会失败 (Because this account will fail no matter what.)
      // 错误情况 1: custom program error: 0x1 jup余额不足 特别是因为 sol 交易发送过但是超时未确认 重试的时候遇到该情况 (Error 1, insufficient jup balance, especially because the sol transaction has been sent but has not been confirmed due to timeout when retrying)
      // 错误情况 2: 这个错误的原因是 账户 sol 不足，请务必保证资金够用 建议 0.01 sol (The reason for this error is insufficient sol in the account. Please make sure that the funds are sufficient. It is recommended to use 0.01 sol.)
      if (error.message.includes("program error: 0x1")) {
        return true;
      }
      return false;
    }
  }

  async withdraw() {
    try {
      let {
        wallet,
        provider: { connection },
      } = this;

      let [c] = await this.getOrCreateEscrow(),
          [d, p] = await this.getOrCreateATAInstruction(
              jupAddress,
              c,
              connection,
              !0,
              wallet.publicKey
          ),
          [y, h] = await this.getOrCreateATAInstruction(
              jupAddress,
              wallet.publicKey,
              connection,
              !0,
              wallet.publicKey
          ),
          g = [p, h].filter(Boolean)

      let signature = await this.program.methods.withdraw().accounts({
            destinationTokens: y,
            escrow: c,
            escrowOwner: wallet.publicKey,
            escrowTokens: d,
            locker: locker,
            payer: wallet.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID
          }).preInstructions([
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: UNIT_PRICE,
        }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: 800000 }),
          ...g
      ]).rpc()

      if (signature) {
        logger.success(
            `第${
                this.index
            } 子进程 (Child process) ${this.wallet.publicKey.toBase58()} 提取JUP成功 (Successful withdraw JUP) ${signature}`
        );
        return true;
      } else {
        logger.error(
            `第${
                this.index
            } 子进程 (Child process) ${this.wallet.publicKey.toBase58()} 提取JUP失败 (withdraw JUP failed)`
        );
        return false;
      }
    } catch (error) {
      logger.error(`交易 (transaction) Error: ${error.message}`);
      // 如果(if) program error: 0x1 在报错中 则返回真(Returns true if an error is reported.) 因为这样该账号无论如何都会失败 (Because this account will fail no matter what.)
      // 错误情况 1: custom program error: 0x1 jup余额不足 特别是因为 sol 交易发送过但是超时未确认 重试的时候遇到该情况 (Error 1, insufficient jup balance, especially because the sol transaction has been sent but has not been confirmed due to timeout when retrying)
      // 错误情况 2: 这个错误的原因是 账户 sol 不足，请务必保证资金够用 建议 0.01 sol (The reason for this error is insufficient sol in the account. Please make sure that the funds are sufficient. It is recommended to use 0.01 sol.)
      if (error.message.includes("program error: 0x1")) {
        return true;
      }
      return false;
    }
  }


  async unStake(stakeAmount) {
    try {
      let {
        wallet,
        provider: { connection },
      } = this;

      let signature = await this.toggleMaxDuration(false);

      if (signature) {
        logger.success(
            `第${
                this.index
            } 子进程 (Child process) ${this.wallet.publicKey.toBase58()} 解除质押成功 (Successful unstake) ${signature}`
        );
        return true;
      } else {
        logger.error(
            `第${
                this.index
            } 子进程 (Child process) ${this.wallet.publicKey.toBase58()} 解除质押失败 (unstake failed)`
        );
        return false;
      }
    } catch (error) {
      logger.error(`交易 (transaction) Error: ${error.message}`);
      // 如果(if) program error: 0x1 在报错中 则返回真(Returns true if an error is reported.) 因为这样该账号无论如何都会失败 (Because this account will fail no matter what.)
      // 错误情况 1: custom program error: 0x1 jup余额不足 特别是因为 sol 交易发送过但是超时未确认 重试的时候遇到该情况 (Error 1, insufficient jup balance, especially because the sol transaction has been sent but has not been confirmed due to timeout when retrying)
      // 错误情况 2: 这个错误的原因是 账户 sol 不足，请务必保证资金够用 建议 0.01 sol (The reason for this error is insufficient sol in the account. Please make sure that the funds are sufficient. It is recommended to use 0.01 sol.)
      if (error.message.includes("program error: 0x1")) {
        return true;
      }
      return false;
    }
  }

  async vote() {
    try {
      let [a, r] = await this.getOrCreateVote(proposalId);

      //查询a是否存在 如果存在 说明已经投票过了 (Check if a exists, if it exists, it means that you have already voted)
      let accountAtaInfo = await this.connection.getAccountInfo(a);
      if (accountAtaInfo) {
        logger.warn(
          `第${
            this.index
          } 子进程 ${this.wallet.publicKey.toBase58()} 投票失败,已经投过票 (Failed to vote, already voted)`
        );
        return true;
      }

      let signature = await this.voteProposal(
        proposalId,
        a,
        governor,
        voteId,
        r ? [r] : []
      );

      if (signature) {
        logger.success(
          `第${
            this.index
          } 子进程 (Child process) ${this.wallet.publicKey.toBase58()} 投票成功 (Successful vote) ${signature}`
        );
        return true;
      } else {
        logger.error(
          `第${
            this.index
          } 子进程 (Child process) ${this.wallet.publicKey.toBase58()} 投票失败 (Failed to vote)`
        );
        return false;
      }
    } catch (error) {
      logger.error(`投票交易 (Voting transaction) Error: ${error.message}`);
      //already initialized 如果是这个报错 说明已经投过票
      if (error.message.includes("already initialized")) {
        return true;
      }
      return false;
    }
  }

  async voteProposal(e, t, a, r) {
    let o = arguments.length > 4 && void 0 !== arguments[4] ? arguments[4] : [],
      { wallet, program } = this;

    o.unshift(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: UNIT_PRICE,
      }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 })
    );
    let [c, l] = deriveEscrow(locker, wallet.publicKey, locked_voter);
    return await program.methods
      .castVote(r)
      .accounts({
        escrow: c,
        governor: a,
        governProgram: Governor,
        locker: locker,
        proposal: e,
        vote: t,
        voteDelegate: wallet.publicKey,
      })
      .preInstructions(o)
      .rpc();
  }

  async getOrCreateVote(e) {
    let { wallet, provider, governProgram } = this,
      [r, o] = deriveVote(wallet.publicKey, e);
    try {
      return await this.governProgram.account.vote.fetch(r), [r, null];
    } catch (n) {
      let o = await this.governProgram.methods
        .newVote(wallet.publicKey)
        .accounts({
          payer: wallet.publicKey,
          proposal: e,
          systemProgram: SystemProgram.programId,
          vote: r,
        })
        .instruction();
      return [r, o];
    }
  }

  async toggleMaxDuration(e, t=[], r=[]) {
    let [a] = await this.getOrCreateEscrow();
    t.unshift(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: UNIT_PRICE,
      }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 800000 })
    );

    return this.program.methods
      .toggleMaxLock(e)
      .accounts({
        escrow: a,
        locker: locker,
        escrowOwner: this.wallet.publicKey,
      })
      .preInstructions(t || [])
      .postInstructions(r || [])
      .rpc();
  }



  async init() {
    try {
      const connection = new anchor.web3.Connection(this.rpc, "confirmed");
      const wallet = await getWallet(this.privateKey);
      const provider = new anchor.AnchorProvider(connection, wallet, {
        commitment: "confirmed",
      });
      const program = new anchor.Program(idl, locked_voter, provider);
      const governProgram = new anchor.Program(governIDL, Governor, provider);
      this.connection = connection;
      this.wallet = wallet;
      this.provider = provider;
      this.program = program;
      this.governProgram = governProgram;

      return true;
    } catch (error) {
      logger.error(`初始化 (initialize) Error: ${error.message}`);
      return false;
    }
  }

  async checkBalance(publicKey) {
    for (let index = 0; index < 5; index++) {
      try {
        const balance = await this.connection.getBalance(publicKey);
        logger.info(
          `${publicKey.toBase58()} 当前余额 (Current balance) ${
            balance / LAMPORTS_PER_SOL
          } SOL`
        );
        return balance;
      } catch (error) {
        logger.error(
          `${publicKey.toBase58()} 获取余额失败,正在重试... (Failed to obtain the balance and is trying again...) ${
            index + 1
          }`
        );
      }
    }
  }

  async checkTokenBalance(publicKey) {
    for (let index = 0; index < 5; index++) {
      try {
        const tokenAccount = await getAssociatedTokenAddress(
          jupAddress,
          publicKey,
          true
        );
        const balance = await this.connection.getTokenAccountBalance(
          tokenAccount
        );
        logger.info(
          `${publicKey.toBase58()} 当前jup余额 (Current jup balance) ${
            balance?.value?.uiAmount
          } JUP`
        );
        return balance?.value?.uiAmount;
      } catch (error) {
        // 如果是这个报错 说明没有jup账户 (If this error is reported, it means that there is no jup account) could not find account
        if (error.message.includes("could not find account")) {
          logger.error(
            `${publicKey.toBase58()} 未找到jup账户 (Jup account not found)`
          );
          return 0;
        }
        logger.error(
          `${publicKey.toBase58()} 获取jup余额失败,正在重试...(Failed to obtain the jup balance and is trying again...) ${
            index + 1
          }`
        );
      }
    }
    return 0;
  }
}

// export default Worker;
module.exports = Worker;
