package com.seunghyeonkim.walletdiary;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class CardAutomationStoreTest {

    @Test
    public void budgetLevelsMatchTheConfiguredThresholds() {
        assertEquals(0, CardAutomationStore.budgetLevel(79, 100));
        assertEquals(80, CardAutomationStore.budgetLevel(80, 100));
        assertEquals(90, CardAutomationStore.budgetLevel(90, 100));
        assertEquals(100, CardAutomationStore.budgetLevel(100, 100));
        assertEquals(100, CardAutomationStore.budgetLevel(125, 100));
    }

    @Test
    public void budgetLevelComparisonDoesNotOverflow() {
        assertEquals(90, CardAutomationStore.budgetLevel(Long.MAX_VALUE - 1L, Long.MAX_VALUE));
        assertEquals(0, CardAutomationStore.budgetLevel(-1L, 100L));
        assertEquals(0, CardAutomationStore.budgetLevel(100L, 0L));
    }
}
