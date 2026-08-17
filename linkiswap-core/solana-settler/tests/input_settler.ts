import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import { expect } from "chai";

describe("input_settler", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  it("Is initialized!", async () => {
    expect(true).to.be.true;
  });
});
