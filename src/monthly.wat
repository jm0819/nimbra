;; Monthly instalment for a price paid over n months at an annual rate (APR as a fraction).
;; payment = P * r * (1 + r)^n / ((1 + r)^n - 1), with r = apr / 12. Zero rate is P / n.
(module
  (func $monthly (export "monthly") (param $p f64) (param $n i32) (param $apr f64) (result f64)
    (local $r f64)
    (local $f f64)
    (local $i i32)
    (local.set $r (f64.div (local.get $apr) (f64.const 12)))
    (if (f64.eq (local.get $r) (f64.const 0))
      (then (return (f64.div (local.get $p) (f64.convert_i32_s (local.get $n))))))
    (local.set $f (f64.const 1))
    (local.set $i (i32.const 0))
    (block $done
      (loop $step
        (br_if $done (i32.ge_s (local.get $i) (local.get $n)))
        (local.set $f (f64.mul (local.get $f) (f64.add (f64.const 1) (local.get $r))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $step)))
    (f64.div
      (f64.mul (f64.mul (local.get $p) (local.get $r)) (local.get $f))
      (f64.sub (local.get $f) (f64.const 1))))
)
