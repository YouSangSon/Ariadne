//go:build !darwin && !linux

package main

func runCheckout([]string) (int, bool) { return 0, false }
