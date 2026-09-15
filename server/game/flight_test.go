package game

import "testing"

// Boost is a limited resource, not a permanent state: held continuously it
// drains to empty within boostFuelMax seconds, and once empty no longer
// raises the speed cap — holding the key past that point is a no-op, not a
// free ride. It also recharges once released.
func TestStepShipBoostFuelDrainsAndRecharges(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	kp := k.Player

	ship := &Ship{Quat: Quat{0, 0, 0, 1}, BoostFuel: kp.BoostFuelMax}
	ctrl := Control{Thrust: 1, Boost: true}

	// hold boost well past boostFuelMax seconds
	ticks := int(kp.BoostFuelMax/tickDT) + 120
	for i := 0; i < ticks; i++ {
		StepShip(ship, ctrl, tickDT, kp)
	}
	if ship.BoostFuel != 0 {
		t.Fatalf("boost fuel didn't run out (still %v after %v ticks)", ship.BoostFuel, ticks)
	}
	if ship.Vel.Length() > kp.MaxSpeed+1e-6 {
		t.Fatalf("still above the unboosted speed cap (%v) after boost ran out: %v", kp.MaxSpeed, ship.Vel.Length())
	}

	// release boost: fuel should recharge over time
	ctrl.Boost = false
	for i := 0; i < int(kp.BoostFuelMax/kp.BoostRechargeRate/tickDT)+60; i++ {
		StepShip(ship, ctrl, tickDT, kp)
	}
	if ship.BoostFuel < kp.BoostFuelMax-1e-6 {
		t.Fatalf("boost fuel didn't fully recharge (got %v, want %v)", ship.BoostFuel, kp.BoostFuelMax)
	}
}

// A short tap of boost shouldn't drain the whole tank, and should reach the
// raised speed cap while fuel remains — the everyday case, not just the
// run-it-dry edge case above.
func TestStepShipBoostRaisesCapWhileFueled(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	kp := k.Player

	ship := &Ship{Quat: Quat{0, 0, 0, 1}, BoostFuel: kp.BoostFuelMax}
	ctrl := Control{Thrust: 1, Boost: true}
	for i := 0; i < int(kp.BoostFuelMax/tickDT); i++ { // exactly a full tank's worth
		StepShip(ship, ctrl, tickDT, kp)
	}
	if ship.Vel.Length() <= kp.MaxSpeed {
		t.Fatalf("boost never exceeded the unboosted cap (%v): got %v", kp.MaxSpeed, ship.Vel.Length())
	}
}
