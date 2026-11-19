package coreapp

import "ariadne/runtime/internal/core/domain/scrub"

func Scrub(input []uint16) []uint16  { return scrub.Scrub(input).Text }
func Detect(input []uint16) []string { return scrub.Detect(input) }
