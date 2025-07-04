
import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export const useProfitGeneration = () => {
  const { toast } = useToast();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastProfitCheckRef = useRef<string | null>(null);

  const activatePlan = async (planId: string, amount: number, userId: string) => {
    try {
      // Get plan details
      const { data: plan, error: planError } = await supabase
        .from('investment_plans')
        .select('*')
        .eq('id', planId)
        .single();

      if (planError) throw planError;

      // Calculate end date
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + plan.duration_days);

      // Create investment record
      const { data: investment, error: investmentError } = await supabase
        .from('user_investments')
        .insert({
          user_id: userId,
          plan_id: planId,
          amount: amount,
          start_date: startDate.toISOString(),
          end_date: endDate.toISOString(),
          is_active: true,
          profit_earned: 0
        })
        .select()
        .single();

      if (investmentError) throw investmentError;

      // Deduct amount from user balance
      const { error: balanceError } = await supabase
        .rpc('update_user_balance', {
          p_user_id: userId,
          p_amount: amount,
          p_operation: 'remove'
        });

      if (balanceError) throw balanceError;

      toast({
        title: "Plan Activated Successfully!",
        description: `Your ${plan.name} plan has been activated. Profits will be credited daily.`,
      });

      return investment;
    } catch (error) {
      console.error('Error activating plan:', error);
      toast({
        title: "Activation Failed",
        description: "Failed to activate plan. Please try again.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const shouldGenerateProfit = () => {
    const now = new Date();
    const today = now.toDateString();
    
    // Check if we already generated profit today
    if (lastProfitCheckRef.current === today) {
      return false;
    }
    
    // Only generate profit at midnight or later (not on page refresh)
    const hours = now.getHours();
    const minutes = now.getMinutes();
    
    // Generate profit between 00:00 and 00:05 to ensure it happens once per day
    if (hours === 0 && minutes < 5) {
      lastProfitCheckRef.current = today;
      return true;
    }
    
    return false;
  };

  const generateDailyProfit = async (investmentId: string, amount: number, dailyProfitPercentage: number) => {
    try {
      const dailyProfit = (amount * dailyProfitPercentage) / 100;

      // Get investment details
      const { data: investment, error: investmentError } = await supabase
        .from('user_investments')
        .select('*, investment_plans(*)')
        .eq('id', investmentId)
        .single();

      if (investmentError) throw investmentError;

      // Check if investment is still active and not expired
      const now = new Date();
      const endDate = new Date(investment.end_date);
      
      if (now > endDate) {
        // Mark investment as inactive if expired
        await supabase
          .from('user_investments')
          .update({ is_active: false })
          .eq('id', investmentId);
        
        console.log(`Investment ${investmentId} has expired and been deactivated`);
        return;
      }

      // Update profit earned
      const { error: updateError } = await supabase
        .from('user_investments')
        .update({
          profit_earned: (Number(investment.profit_earned) + dailyProfit)
        })
        .eq('id', investmentId);

      if (updateError) throw updateError;

      // Credit profit to user balance
      const { error: balanceError } = await supabase
        .rpc('update_user_balance', {
          p_user_id: investment.user_id,
          p_amount: dailyProfit,
          p_operation: 'add'
        });

      if (balanceError) throw balanceError;

      // Send notification about profit credit
      await supabase.rpc('send_user_notification', {
        p_user_id: investment.user_id,
        p_title: 'Daily Profit Credited',
        p_message: `$${dailyProfit.toFixed(2)} profit has been credited to your account from ${investment.investment_plans.name}`,
        p_type: 'success'
      });

      console.log(`Daily profit of $${dailyProfit.toFixed(2)} credited for investment ${investmentId}`);
    } catch (error) {
      console.error('Error generating daily profit:', error);
    }
  };

  // Auto-generate profits for active investments (only at scheduled times)
  useEffect(() => {
    const generateProfitsForActiveInvestments = async () => {
      // Only generate profits at the right time, not on every page load
      if (!shouldGenerateProfit()) {
        return;
      }

      try {
        const { data: investments, error } = await supabase
          .from('user_investments')
          .select('*, investment_plans(*)')
          .eq('is_active', true)
          .gte('end_date', new Date().toISOString());

        if (error) throw error;

        console.log(`Processing daily profits for ${investments?.length || 0} active investments`);

        for (const investment of investments || []) {
          await generateDailyProfit(
            investment.id,
            Number(investment.amount),
            Number(investment.investment_plans.daily_profit_percentage)
          );
        }
      } catch (error) {
        console.error('Error generating profits:', error);
      }
    };

    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    // Check immediately (but won't generate unless it's the right time)
    generateProfitsForActiveInvestments();
    
    // Set up interval to check every hour (but only generate at midnight)
    intervalRef.current = setInterval(generateProfitsForActiveInvestments, 60 * 60 * 1000);

    // Cleanup function
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []); // Empty dependency array to run only once

  return { activatePlan };
};
