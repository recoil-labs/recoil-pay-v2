use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("5N4t4qM6t9tP8KkHwU1o9EHTZtS1W5rV3GfX9vQ5tZ8N");

#[program]
pub mod input_settler {
    use super::*;

    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        msg!("Input Settler Initialized");
        Ok(())
    }

    pub fn create_intent(
        ctx: Context<CreateIntent>,
        amount: u64,
        destination_chain: u64,
        destination_token: String,
        receiver: String,
    ) -> Result<()> {
        let intent = &mut ctx.accounts.intent;
        intent.sender = ctx.accounts.sender.key();
        intent.mint = ctx.accounts.mint.key();
        intent.amount = amount;
        intent.destination_chain = destination_chain;
        intent.destination_token = destination_token.clone();
        intent.receiver = receiver.clone();
        intent.vault = ctx.accounts.escrow_vault.key();
        
        let cpi_accounts = Transfer {
            from: ctx.accounts.sender_token_account.to_account_info(),
            to: ctx.accounts.escrow_vault.to_account_info(),
            authority: ctx.accounts.sender.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        emit!(IntentCreated {
            intent_id: intent.key(),
            sender: intent.sender,
            amount,
            destination_chain,
            destination_token,
            receiver,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}

#[derive(Accounts)]
pub struct CreateIntent<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,
    
    #[account(
        init,
        payer = sender,
        space = 8 + 32 + 32 + 8 + 8 + 64 + 64 + 32,
        seeds = [b"intent", sender.key().as_ref(), mint.key().as_ref()],
        bump
    )]
    pub intent: Account<'info, IntentData>,
    
    pub mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub sender_token_account: Account<'info, TokenAccount>,
    
    #[account(
        init_if_needed,
        payer = sender,
        token::mint = mint,
        token::authority = intent,
        seeds = [b"vault", intent.key().as_ref()],
        bump
    )]
    pub escrow_vault: Account<'info, TokenAccount>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct IntentData {
    pub sender: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub destination_chain: u64,
    pub destination_token: String,
    pub receiver: String,
    pub vault: Pubkey,
}

#[event]
pub struct IntentCreated {
    pub intent_id: Pubkey,
    pub sender: Pubkey,
    pub amount: u64,
    pub destination_chain: u64,
    pub destination_token: String,
    pub receiver: String,
}
