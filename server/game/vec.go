package game

import "math"

// Faithful Go ports of the THREE.js Vector3 / Quaternion / Euler ops that
// shared/sim/vec.js re-exports. Same formulas, same operation order — the
// golden-vector test (tol 1e-4) guards against drift. Methods mutate the
// receiver and return it, THREE-style.

const epsilon = 2.220446049250313e-16 // Number.EPSILON

type Vec3 struct{ X, Y, Z float64 }
type Quat struct{ X, Y, Z, W float64 }

func V3(x, y, z float64) Vec3 { return Vec3{x, y, z} }

func (v *Vec3) Set(x, y, z float64) *Vec3 { v.X, v.Y, v.Z = x, y, z; return v }
func (v *Vec3) Copy(o Vec3) *Vec3         { *v = o; return v }
func (v Vec3) Clone() Vec3                { return v }

func (v *Vec3) Add(o Vec3) *Vec3 { v.X += o.X; v.Y += o.Y; v.Z += o.Z; return v }
func (v *Vec3) Sub(o Vec3) *Vec3 { v.X -= o.X; v.Y -= o.Y; v.Z -= o.Z; return v }
func (v *Vec3) SubVectors(a, b Vec3) *Vec3 {
	v.X, v.Y, v.Z = a.X-b.X, a.Y-b.Y, a.Z-b.Z
	return v
}
func (v *Vec3) AddScaledVector(o Vec3, s float64) *Vec3 {
	v.X += o.X * s
	v.Y += o.Y * s
	v.Z += o.Z * s
	return v
}
func (v *Vec3) MultiplyScalar(s float64) *Vec3 { v.X *= s; v.Y *= s; v.Z *= s; return v }
func (v *Vec3) Negate() *Vec3                  { v.X, v.Y, v.Z = -v.X, -v.Y, -v.Z; return v }

func (v Vec3) Dot(o Vec3) float64 { return v.X*o.X + v.Y*o.Y + v.Z*o.Z }
func (v Vec3) LengthSq() float64  { return v.X*v.X + v.Y*v.Y + v.Z*v.Z }
func (v Vec3) Length() float64    { return math.Sqrt(v.LengthSq()) }
func (v Vec3) DistanceToSq(o Vec3) float64 {
	dx, dy, dz := v.X-o.X, v.Y-o.Y, v.Z-o.Z
	return dx*dx + dy*dy + dz*dz
}
func (v Vec3) DistanceTo(o Vec3) float64 { return math.Sqrt(v.DistanceToSq(o)) }

func (v *Vec3) CrossVectors(a, b Vec3) *Vec3 {
	v.X = a.Y*b.Z - a.Z*b.Y
	v.Y = a.Z*b.X - a.X*b.Z
	v.Z = a.X*b.Y - a.Y*b.X
	return v
}

// normalize = divideScalar(length() || 1)
func (v *Vec3) Normalize() *Vec3 {
	l := v.Length()
	if l == 0 {
		l = 1
	}
	return v.MultiplyScalar(1 / l)
}

// setLength = normalize().multiplyScalar(l)
func (v *Vec3) SetLength(l float64) *Vec3 { return v.Normalize().MultiplyScalar(l) }

// lerp: x += (o.x - x) * a
func (v *Vec3) Lerp(o Vec3, a float64) *Vec3 {
	v.X += (o.X - v.X) * a
	v.Y += (o.Y - v.Y) * a
	v.Z += (o.Z - v.Z) * a
	return v
}

// applyQuaternion — THREE Vector3.applyQuaternion
func (v *Vec3) ApplyQuaternion(q Quat) *Vec3 {
	x, y, z := v.X, v.Y, v.Z
	qx, qy, qz, qw := q.X, q.Y, q.Z, q.W
	tx := 2 * (qy*z - qz*y)
	ty := 2 * (qz*x - qx*z)
	tz := 2 * (qx*y - qy*x)
	v.X = x + qw*tx + qy*tz - qz*ty
	v.Y = y + qw*ty + qz*tx - qx*tz
	v.Z = z + qw*tz + qx*ty - qy*tx
	return v
}

// ---- Quaternion ----------------------------------------------------------

func (q *Quat) Copy(o Quat) *Quat { *q = o; return q }
func (q Quat) Clone() Quat        { return q }
func (q *Quat) Identity() *Quat   { q.X, q.Y, q.Z, q.W = 0, 0, 0, 1; return q }

func (q Quat) LengthQ() float64 { return math.Sqrt(q.X*q.X + q.Y*q.Y + q.Z*q.Z + q.W*q.W) }

func (q *Quat) Normalize() *Quat {
	l := q.LengthQ()
	if l == 0 {
		q.X, q.Y, q.Z, q.W = 0, 0, 0, 1
	} else {
		l = 1 / l
		q.X *= l
		q.Y *= l
		q.Z *= l
		q.W *= l
	}
	return q
}

func (q Quat) Dot(o Quat) float64 { return q.X*o.X + q.Y*o.Y + q.Z*o.Z + q.W*o.W }

// setFromUnitVectors — THREE Quaternion.setFromUnitVectors
func (q *Quat) SetFromUnitVectors(vFrom, vTo Vec3) *Quat {
	r := vFrom.Dot(vTo) + 1
	if r < epsilon {
		r = 0
		if math.Abs(vFrom.X) > math.Abs(vFrom.Z) {
			q.X, q.Y, q.Z, q.W = -vFrom.Y, vFrom.X, 0, r
		} else {
			q.X, q.Y, q.Z, q.W = 0, -vFrom.Z, vFrom.Y, r
		}
	} else {
		q.X = vFrom.Y*vTo.Z - vFrom.Z*vTo.Y
		q.Y = vFrom.Z*vTo.X - vFrom.X*vTo.Z
		q.Z = vFrom.X*vTo.Y - vFrom.Y*vTo.X
		q.W = r
	}
	return q.Normalize()
}

// setFromEuler with order 'XYZ' — THREE Quaternion.setFromEuler
func (q *Quat) SetFromEulerXYZ(x, y, z float64) *Quat {
	c1, c2, c3 := math.Cos(x/2), math.Cos(y/2), math.Cos(z/2)
	s1, s2, s3 := math.Sin(x/2), math.Sin(y/2), math.Sin(z/2)
	q.X = s1*c2*c3 + c1*s2*s3
	q.Y = c1*s2*c3 - s1*c2*s3
	q.Z = c1*c2*s3 + s1*s2*c3
	q.W = c1*c2*c3 - s1*s2*s3
	return q
}

// multiply = multiplyQuaternions(this, o)
func (q *Quat) Multiply(o Quat) *Quat {
	qax, qay, qaz, qaw := q.X, q.Y, q.Z, q.W
	qbx, qby, qbz, qbw := o.X, o.Y, o.Z, o.W
	q.X = qax*qbw + qaw*qbx + qay*qbz - qaz*qby
	q.Y = qay*qbw + qaw*qby + qaz*qbx - qax*qbz
	q.Z = qaz*qbw + qaw*qbz + qax*qby - qay*qbx
	q.W = qaw*qbw - qax*qbx - qay*qby - qaz*qbz
	return q
}

// angleTo — THREE Quaternion.angleTo
func (q Quat) AngleTo(o Quat) float64 {
	d := q.Dot(o)
	if d < -1 {
		d = -1
	} else if d > 1 {
		d = 1
	}
	return 2 * math.Acos(math.Abs(d))
}

// slerp — THREE Quaternion.slerp (mutates receiver toward qb by t)
func (q *Quat) Slerp(qb Quat, t float64) *Quat {
	if t == 0 {
		return q
	}
	if t == 1 {
		return q.Copy(qb)
	}
	x, y, z, w := q.X, q.Y, q.Z, q.W
	cosHalfTheta := w*qb.W + x*qb.X + y*qb.Y + z*qb.Z
	if cosHalfTheta < 0 {
		q.W, q.X, q.Y, q.Z = -qb.W, -qb.X, -qb.Y, -qb.Z
		cosHalfTheta = -cosHalfTheta
	} else {
		q.Copy(qb)
	}
	if cosHalfTheta >= 1.0 {
		q.W, q.X, q.Y, q.Z = w, x, y, z
		return q
	}
	sqrSinHalfTheta := 1.0 - cosHalfTheta*cosHalfTheta
	if sqrSinHalfTheta <= epsilon {
		s := 1 - t
		q.W = s*w + t*q.W
		q.X = s*x + t*q.X
		q.Y = s*y + t*q.Y
		q.Z = s*z + t*q.Z
		return q.Normalize()
	}
	sinHalfTheta := math.Sqrt(sqrSinHalfTheta)
	halfTheta := math.Atan2(sinHalfTheta, cosHalfTheta)
	ratioA := math.Sin((1-t)*halfTheta) / sinHalfTheta
	ratioB := math.Sin(t*halfTheta) / sinHalfTheta
	q.W = w*ratioA + q.W*ratioB
	q.X = x*ratioA + q.X*ratioB
	q.Y = y*ratioA + q.Y*ratioB
	q.Z = z*ratioA + q.Z*ratioB
	return q
}

// rotateTowards — THREE Quaternion.rotateTowards
func (q *Quat) RotateTowards(target Quat, step float64) *Quat {
	angle := q.AngleTo(target)
	if angle == 0 {
		return q
	}
	t := step / angle
	if t > 1 {
		t = 1
	}
	return q.Slerp(target, t)
}

func clamp(x, lo, hi float64) float64 {
	if x < lo {
		return lo
	}
	if x > hi {
		return hi
	}
	return x
}
